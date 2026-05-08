const fs = require('fs');
const path = require('path');

function ensureString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function buildPromotionBranchName(shortSha, prefix = 'promote-prod') {
  return `${ensureString(prefix, 'promote-prod')}-${ensureString(shortSha, 'manual')}`;
}

function extractImageFromManifest(content) {
  const match = ensureString(content).match(/^\s*image:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

function getContext() {
  const buildBranch = ensureString(process.env.BUILD_METADATA_BRANCH, 'build');
  const stageBranch = ensureString(process.env.STAGE_GITOPS_BRANCH, 'stage');
  const prodBranch = ensureString(process.env.PROD_GITOPS_BRANCH, 'prod');

  return {
    apiV4Url: ensureString(process.env.CI_API_V4_URL),
    projectId: ensureString(process.env.CI_PROJECT_ID),
    projectPath: ensureString(process.env.CI_PROJECT_PATH, 'local/dev-cicd-challenge'),
    projectUrl: ensureString(process.env.CI_PROJECT_URL),
    pipelineUrl: ensureString(process.env.CI_PIPELINE_URL),
    commitSha: ensureString(process.env.CI_COMMIT_SHA),
    commitShortSha: ensureString(process.env.CI_COMMIT_SHORT_SHA),
    buildBranch,
    stageBranch,
    prodBranch,
    sourceBranch: ensureString(
      process.env.PROMOTION_SOURCE_BRANCH,
      buildPromotionBranchName(process.env.CI_COMMIT_SHORT_SHA, process.env.PROD_PROMOTION_BRANCH_PREFIX)
    ),
    targetBranch: ensureString(process.env.PROMOTION_TARGET_BRANCH, prodBranch),
    token: ensureString(process.env.GITLAB_API_KEY || process.env.GITOPS_PUSH_TOKEN),
    manifestPath: ensureString(process.env.PROMOTION_MANIFEST_PATH, path.join(__dirname, '..', 'k8s', 'rollout.yaml'))
  };
}

function buildMergeRequestPayload(context, imageReference) {
  const shortSha = ensureString(context.commitShortSha, context.commitSha.slice(0, 8));
  return {
    title: `Promote ${shortSha} from ${context.stageBranch || 'stage'} to ${context.prodBranch || 'prod'}`,
    description: [
      '## Production promotion gate',
      '',
      'This merge request was generated automatically after the complete stage validation finished successfully.',
      '',
      '### Branch flow',
      `- Build branch: ${context.buildBranch || 'build'}`,
      `- Stage branch: ${context.stageBranch || 'stage'}`,
      `- Prod branch: ${context.prodBranch || 'prod'}`,
      '',
      '### Promotion artifact',
      `- Image: ${imageReference || 'unknown'}`,
      `- Promotion branch: ${context.sourceBranch}`,
      `- Target branch: ${context.targetBranch}`,
      context.pipelineUrl ? `- Stage pipeline: ${context.pipelineUrl}` : null,
      context.projectUrl ? `- Project: ${context.projectUrl}` : null,
      '',
      '### Merge checklist',
      '- [ ] Confirm the stage smoke test stayed green after deployment.',
      '- [ ] Review the image tag and rollout diff.',
      '- [ ] Merge this MR to promote the validated image into prod.'
    ].filter(Boolean).join('\n'),
    remove_source_branch: true,
    labels: 'promotion,prod,env::prod'
  };
}

async function gitlabRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': token,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function findOpenMergeRequest(context) {
  const query = new URLSearchParams({
    state: 'opened',
    source_branch: context.sourceBranch,
    target_branch: context.targetBranch
  });
  const url = `${context.apiV4Url}/projects/${encodeURIComponent(context.projectId)}/merge_requests?${query.toString()}`;
  const mergeRequests = await gitlabRequest(url, context.token, { method: 'GET' });
  return mergeRequests[0] || null;
}

async function createMergeRequest(context, payload) {
  const url = `${context.apiV4Url}/projects/${encodeURIComponent(context.projectId)}/merge_requests`;
  return gitlabRequest(url, context.token, {
    method: 'POST',
    body: JSON.stringify({
      source_branch: context.sourceBranch,
      target_branch: context.targetBranch,
      title: payload.title,
      description: payload.description,
      remove_source_branch: payload.remove_source_branch,
      labels: payload.labels
    })
  });
}

async function main() {
  const context = getContext();

  if (!context.apiV4Url || !context.projectId) {
    throw new Error('Missing CI_API_V4_URL or CI_PROJECT_ID.');
  }

  if (!context.token) {
    throw new Error('GITLAB_API_KEY (or a compatible API token) is required to create the prod promotion MR.');
  }

  if (!fs.existsSync(context.manifestPath)) {
    throw new Error(`Promotion manifest not found at ${context.manifestPath}.`);
  }

  const imageReference = extractImageFromManifest(fs.readFileSync(context.manifestPath, 'utf8'));
  const existingMergeRequest = await findOpenMergeRequest(context);

  if (existingMergeRequest) {
    console.log(`Prod promotion MR already exists: ${existingMergeRequest.web_url}`);
    return existingMergeRequest;
  }

  const mergeRequest = await createMergeRequest(context, buildMergeRequestPayload(context, imageReference));
  console.log(`Prod promotion MR created: ${mergeRequest.web_url}`);
  return mergeRequest;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Failed to create prod promotion MR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildMergeRequestPayload,
  buildPromotionBranchName,
  extractImageFromManifest
};