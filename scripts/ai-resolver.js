const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_PATH = path.join(__dirname, '..', 'logs', 'pipeline_failure.log');
const DEFAULT_DOTENV_PATH = path.join(__dirname, '..', '.env');
const ARTIFACTS_DIR = path.join(__dirname, '..', 'artifacts');
const MARKDOWN_OUTPUT_PATH = path.join(ARTIFACTS_DIR, 'incident_report.md');
const JSON_OUTPUT_PATH = path.join(ARTIFACTS_DIR, 'incident_report.json');
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_PROMPT_CHARS = 12000;
const MAX_TRACE_CHARS = 4000;
const FAILED_JOB_TRACE_LIMIT = 3;

function loadDotEnv(dotenvPath = DEFAULT_DOTENV_PATH) {
  if (!fs.existsSync(dotenvPath)) {
    return;
  }

  const contents = fs.readFileSync(dotenvPath, 'utf8');

  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

loadDotEnv();

function ensureString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getGeminiModel() {
  return ensureString(process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL);
}

function truncateText(text, maxChars = MAX_PROMPT_CHARS) {
  if (!text) {
    return '';
  }

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function normalizeConfidence(value) {
  const normalized = ensureString(value).toLowerCase();

  if (normalized === 'high') {
    return 'High';
  }

  if (normalized === 'medium') {
    return 'Medium';
  }

  return 'Low';
}

function normalizeYesNo(value) {
  const normalized = ensureString(value).toLowerCase();
  return ['yes', 'true', 'required', 'si', 'sí'].includes(normalized) ? 'Yes' : 'No';
}

function normalizeSeverity(value) {
  const normalized = ensureString(value).toLowerCase();

  if (['critical', 'critico', 'crítico', 'sev0', 'p0'].includes(normalized)) {
    return 'critical';
  }

  if (['high', 'alto', 'sev1', 'p1'].includes(normalized)) {
    return 'high';
  }

  if (['medium', 'med', 'medio', 'sev2', 'p2'].includes(normalized)) {
    return 'medium';
  }

  if (['low', 'bajo', 'sev3', 'p3'].includes(normalized)) {
    return 'low';
  }

  return '';
}

function titleCaseSeverity(severity) {
  const normalized = normalizeSeverity(severity) || 'low';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function inferStepFailed(logContent) {
  const lower = ensureString(logContent).toLowerCase();

  if (lower.includes('smoke_test_blue_active') || lower.includes('blue-active')) {
    return 'Blue Active Smoke Test';
  }

  if (lower.includes('smoke_test_green_preview') || lower.includes('green-preview')) {
    return 'Green Preview Smoke Test';
  }

  if (lower.includes('rollout') || lower.includes('deployment') || lower.includes('deploy')) {
    return 'Deploy Validation';
  }

  if (lower.includes('kaniko') || lower.includes('registry')) {
    return 'Image Build / Push';
  }

  if (lower.includes('jest') || lower.includes('__tests__') || lower.includes('expected: 200')) {
    return 'Unit Tests';
  }

  return 'Unknown Step';
}

function inferSeverity({
  stepFailed = '',
  probableRootCause = '',
  suggestedFix = '',
  recommendedAction = '',
  rollbackRequired = 'No',
  logContent = ''
}) {
  const combined = [stepFailed, probableRootCause, suggestedFix, recommendedAction, logContent]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (normalizeYesNo(rollbackRequired) === 'Yes') {
    return 'critical';
  }

  if (
    combined.includes('blue-active') ||
    combined.includes('production') ||
    combined.includes('rollback') ||
    combined.includes('service down') ||
    combined.includes('outage') ||
    (combined.includes('health') && combined.includes('500') && combined.includes('deploy'))
  ) {
    return 'critical';
  }

  if (
    combined.includes('smoke test') ||
    combined.includes('health check failed') ||
    combined.includes('healthcheck returned status') ||
    combined.includes('deploy') ||
    combined.includes('rollout') ||
    combined.includes('argocd') ||
    combined.includes('kubernetes') ||
    combined.includes('service dns') ||
    combined.includes('registry') ||
    combined.includes('kaniko') ||
    combined.includes('manifest')
  ) {
    return 'high';
  }

  if (
    combined.includes('unit test') ||
    combined.includes('jest') ||
    combined.includes('__tests__') ||
    combined.includes('expected: 200') ||
    combined.includes('received: 500') ||
    combined.includes('lint') ||
    combined.includes('app_env')
  ) {
    return 'medium';
  }

  return 'low';
}

function buildMockAnalysis(logContent) {
  const lower = ensureString(logContent).toLowerCase();
  const analysis = {
    stepFailed: inferStepFailed(logContent),
    probableRootCause: 'Unknown error in pipeline.',
    confidence: 'Low',
    suggestedFix: 'Inspect the failing job logs manually and re-run the pipeline after applying the fix.',
    recommendedAction: 'Inspect the failing job logs and rerun the pipeline.',
    rollbackRequired: 'No',
    severity: 'low'
  };

  if (lower.includes('expected: 200') && lower.includes('received: 500')) {
    analysis.stepFailed = 'Unit Tests';
    analysis.probableRootCause = 'Health endpoint returned 500 because APP_ENV was missing in the runtime or test environment.';
    analysis.confidence = 'High';
    analysis.suggestedFix = 'Set APP_ENV in the failing environment or update the application logic/tests to provide a valid value.';
    analysis.recommendedAction = 'Fix the environment configuration and rerun the pipeline.';
  }

  if (
    lower.includes('smoke test') ||
    lower.includes('healthcheck returned status') ||
    lower.includes('service dns record not found')
  ) {
    analysis.stepFailed = analysis.stepFailed === 'Unknown Step' ? 'Deploy Validation' : analysis.stepFailed;
    analysis.probableRootCause = 'The deployed service did not become healthy in time or the Kubernetes service/DNS was not ready.';
    analysis.confidence = 'Medium';
    analysis.suggestedFix = 'Validate the deployment manifest, service exposure, environment variables and rollout health before promoting.';
    analysis.recommendedAction = 'Inspect the failing deploy or smoke job trace and verify service readiness.';
    analysis.rollbackRequired = lower.includes('blue-active') ? 'Yes' : 'No';
  }

  analysis.severity = inferSeverity({ ...analysis, logContent });
  return analysis;
}

function parseMarkdownAnalysis(text) {
  const getField = (label) => {
    const expression = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i');
    const match = ensureString(text).match(expression);
    return match ? match[1].trim() : '';
  };

  return {
    stepFailed: getField('Step failed'),
    probableRootCause: getField('Probable root cause'),
    confidence: getField('Confidence'),
    suggestedFix: getField('Suggested fix'),
    recommendedAction: getField('Recommended action'),
    rollbackRequired: getField('Rollback required'),
    severity: getField('Severity')
  };
}

function tryParseJson(text) {
  if (!ensureString(text)) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

function normalizeAnalysis(rawAnalysis, logContent) {
  const fallback = buildMockAnalysis(logContent);
  const candidate = rawAnalysis || {};

  const analysis = {
    stepFailed: ensureString(candidate.stepFailed, fallback.stepFailed),
    probableRootCause: ensureString(candidate.probableRootCause, fallback.probableRootCause),
    confidence: normalizeConfidence(candidate.confidence || fallback.confidence),
    suggestedFix: ensureString(candidate.suggestedFix, fallback.suggestedFix),
    recommendedAction: ensureString(candidate.recommendedAction, fallback.recommendedAction),
    rollbackRequired: normalizeYesNo(candidate.rollbackRequired || fallback.rollbackRequired),
    severity: normalizeSeverity(candidate.severity)
  };

  analysis.severity = analysis.severity || inferSeverity({ ...analysis, logContent });
  return analysis;
}

function parseAiResponse(text, logContent) {
  const parsedJson = tryParseJson(text);

  if (parsedJson) {
    return normalizeAnalysis(parsedJson, logContent);
  }

  return normalizeAnalysis(parseMarkdownAnalysis(text), logContent);
}

function getCiContext() {
  return {
    apiV4Url: process.env.CI_API_V4_URL || '',
    projectId: process.env.CI_PROJECT_ID || '',
    projectPath: process.env.CI_PROJECT_PATH || 'local/dev-cicd-challenge',
    projectUrl: process.env.CI_PROJECT_URL || '',
    pipelineId: process.env.CI_PIPELINE_ID || '',
    pipelineUrl: process.env.CI_PIPELINE_URL || '',
    jobUrl: process.env.CI_JOB_URL || '',
    refName: process.env.CI_COMMIT_REF_NAME || '',
    commitSha: process.env.CI_COMMIT_SHA || '',
    commitShortSha: process.env.CI_COMMIT_SHORT_SHA || (process.env.CI_COMMIT_SHA || '').slice(0, 8),
    gitlabApiKey: process.env.GITLAB_API_KEY || '',
    geminiModel: getGeminiModel()
  };
}

function getLocalLogContent(logPath) {
  if (fs.existsSync(logPath)) {
    return fs.readFileSync(logPath, 'utf8');
  }

  console.warn(`Log file not found at: ${logPath}. Will try GitLab job traces instead.`);
  return '';
}

function rankFailedJob(job) {
  const combined = `${job.stage || ''} ${job.name || ''}`.toLowerCase();

  if (combined.includes('blue') || combined.includes('prod') || combined.includes('production')) {
    return 0;
  }

  if (
    combined.includes('smoke') ||
    combined.includes('deploy') ||
    combined.includes('rollout') ||
    combined.includes('update_manifest') ||
    combined.includes('build')
  ) {
    return 1;
  }

  if (combined.includes('test')) {
    return 2;
  }

  return 3;
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      'PRIVATE-TOKEN': token
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchText(url, token) {
  const response = await fetch(url, {
    headers: {
      'PRIVATE-TOKEN': token
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab trace request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchFailedJobs(context) {
  if (!context.gitlabApiKey || !context.apiV4Url || !context.projectId || !context.pipelineId) {
    return [];
  }

  try {
    const jobsUrl = `${context.apiV4Url}/projects/${encodeURIComponent(context.projectId)}/pipelines/${context.pipelineId}/jobs`;
    const jobs = await fetchJson(jobsUrl, context.gitlabApiKey);

    const failedJobs = jobs
      .filter((job) => job.status === 'failed')
      .sort((left, right) => rankFailedJob(left) - rankFailedJob(right))
      .slice(0, FAILED_JOB_TRACE_LIMIT);

    return Promise.all(
      failedJobs.map(async (job) => {
        let traceExcerpt = '';

        try {
          const traceUrl = `${context.apiV4Url}/projects/${encodeURIComponent(context.projectId)}/jobs/${job.id}/trace`;
          traceExcerpt = truncateText(await fetchText(traceUrl, context.gitlabApiKey), MAX_TRACE_CHARS);
        } catch (error) {
          console.warn(`Could not fetch trace for failed job ${job.name}: ${error.message}`);
        }

        return {
          id: job.id,
          name: job.name,
          stage: job.stage,
          webUrl: job.web_url || '',
          traceExcerpt
        };
      })
    );
  } catch (error) {
    console.warn(`Could not fetch failed jobs from GitLab API: ${error.message}`);
    return [];
  }
}

function buildAnalysisInput(localLogContent, failedJobs) {
  const sections = [];

  if (failedJobs.length > 0) {
    sections.push(
      failedJobs
        .map((job, index) => {
          const trace = job.traceExcerpt || 'Trace unavailable.';
          return [
            `Failed job ${index + 1}: ${job.name}`,
            `Stage: ${job.stage || 'unknown'}`,
            job.webUrl ? `URL: ${job.webUrl}` : null,
            'Trace:',
            '```text',
            trace,
            '```'
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n')
    );
  }

  if (ensureString(localLogContent)) {
    sections.push(['Fallback local log:', '```text', truncateText(localLogContent), '```'].join('\n'));
  }

  return sections.join('\n\n') || 'No log content found.';
}

async function analyzeLogWithAI(logContent) {
  const apiKey = process.env.GEMINI_API_KEY;
  const geminiModel = getGeminiModel();

  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set. Falling back to heuristic analysis.');
    return buildMockAnalysis(logContent);
  }

  const prompt = `You are an AI Incident Resolver for a GitLab CI/CD pipeline.
Analyze the failure context and return ONLY valid JSON with the following shape:
{
  "stepFailed": "string",
  "probableRootCause": "string",
  "confidence": "High|Medium|Low",
  "suggestedFix": "string",
  "recommendedAction": "string",
  "rollbackRequired": "Yes|No",
  "severity": "critical|high|medium|low"
}

Severity guidance:
- critical: production outage, blue-active failure, rollback required, severe availability risk
- high: deploy, smoke test, rollout, registry, service exposure or manifest failures
- medium: unit or integration test failures with no production impact
- low: non-blocking or informational pipeline issues

Failure context:
${truncateText(logContent)}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      console.error(`Gemini API error for model ${geminiModel}: ${response.status} ${response.statusText}`);
      return buildMockAnalysis(logContent);
    }

    const data = await response.json();
    const responseText = ensureString(
      data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n')
    );

    if (!responseText) {
      console.warn(`Gemini response was empty for model ${geminiModel}. Falling back to heuristic analysis.`);
      return buildMockAnalysis(logContent);
    }

    return parseAiResponse(responseText, logContent);
  } catch (error) {
    console.error(`Failed to call Gemini API with model ${geminiModel}:`, error);
    return buildMockAnalysis(logContent);
  }
}

function getIssueLabels(analysis, failedJobs = []) {
  const labels = new Set(['ai-resolver', 'pipeline-failure', `severity::${analysis.severity}`]);
  const combined = [
    analysis.stepFailed,
    analysis.probableRootCause,
    ...failedJobs.map((job) => `${job.stage || ''} ${job.name || ''}`)
  ]
    .join(' ')
    .toLowerCase();

  if (
    combined.includes('deploy') ||
    combined.includes('smoke') ||
    combined.includes('rollout') ||
    combined.includes('preview') ||
    combined.includes('blue') ||
    combined.includes('manifest') ||
    combined.includes('registry') ||
    combined.includes('service')
  ) {
    labels.add('deploy');
  } else {
    labels.add('ci');
  }

  if (analysis.rollbackRequired === 'Yes') {
    labels.add('rollback-required');
  }

  return Array.from(labels);
}

function buildIssuePayload(analysis, context, failedJobs = []) {
  const severityTitle = titleCaseSeverity(analysis.severity);
  const labels = getIssueLabels(analysis, failedJobs);
  const issueTitle = `[${severityTitle}] ${context.projectPath} incident - ${analysis.stepFailed}`;

  const failedJobsSection = failedJobs.length
    ? failedJobs
        .map((job) => {
          const parts = [`- ${job.name} (${job.stage || 'unknown'})`];

          if (job.webUrl) {
            parts.push(job.webUrl);
          }

          return parts.join(' - ');
        })
        .join('\n')
    : '- No failed jobs could be fetched from GitLab API.';

  const issueDescription = `## AI Incident Resolver\n\n**AI model:** ${context.geminiModel}\n**Severity:** ${severityTitle}\n**Step failed:** ${analysis.stepFailed}\n**Probable root cause:** ${analysis.probableRootCause}\n**Confidence:** ${analysis.confidence}\n**Suggested fix:** ${analysis.suggestedFix}\n**Recommended action:** ${analysis.recommendedAction}\n**Rollback required:** ${analysis.rollbackRequired}\n\n## Pipeline context\n- Project: ${context.projectPath}\n- Ref: ${context.refName || 'n/a'}\n- Commit: ${context.commitShortSha || context.commitSha || 'n/a'}\n- Pipeline: ${context.pipelineUrl || 'n/a'}\n- Resolver job: ${context.jobUrl || 'n/a'}\n\n## Failed jobs\n${failedJobsSection}\n`;

  return {
    title: issueTitle,
    description: issueDescription,
    labels
  };
}

async function createGitLabIssue(analysis, context, failedJobs = []) {
  if (!context.gitlabApiKey) {
    console.warn('GITLAB_API_KEY is not set. Skipping GitLab issue creation.');
    return {
      created: false,
      reason: 'GITLAB_API_KEY is not configured.'
    };
  }

  if (!context.apiV4Url || !context.projectId) {
    console.warn('GitLab CI context is incomplete. Skipping GitLab issue creation.');
    return {
      created: false,
      reason: 'Missing CI_API_V4_URL or CI_PROJECT_ID.'
    };
  }

  const issuePayload = buildIssuePayload(analysis, context, failedJobs);
  const body = new URLSearchParams();
  body.set('title', issuePayload.title);
  body.set('description', issuePayload.description);
  body.set('labels', issuePayload.labels.join(','));

  try {
    const issueUrl = `${context.apiV4Url}/projects/${encodeURIComponent(context.projectId)}/issues`;
    const response = await fetch(issueUrl, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': context.gitlabApiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!response.ok) {
      throw new Error(`GitLab issue creation failed: ${response.status} ${response.statusText}`);
    }

    const issue = await response.json();
    return {
      created: true,
      iid: issue.iid,
      title: issue.title,
      webUrl: issue.web_url,
      labels: issuePayload.labels
    };
  } catch (error) {
    console.error(`Could not create GitLab issue: ${error.message}`);
    return {
      created: false,
      reason: error.message,
      labels: issuePayload.labels
    };
  }
}

function formatMarkdownReport(analysis, issue, context, failedJobs = []) {
  const failedJobsSection = failedJobs.length
    ? failedJobs
        .map((job) => `- ${job.name} (${job.stage || 'unknown'})${job.webUrl ? ` - ${job.webUrl}` : ''}`)
        .join('\n')
    : '- No failed jobs were fetched from GitLab API.';

  const issueLine = issue.created
    ? `[Issue #${issue.iid}](${issue.webUrl})`
    : `Not created (${issue.reason || 'GitLab issue creation skipped.'})`;

  return `# Incident Summary\n\n**AI model:** ${context.geminiModel}\n\n**Step failed:** ${analysis.stepFailed}\n\n**Severity:** ${titleCaseSeverity(analysis.severity)}\n\n**Probable root cause:** ${analysis.probableRootCause}\n\n**Confidence:** ${analysis.confidence}\n\n**Suggested fix:** ${analysis.suggestedFix}\n\n**Recommended action:** ${analysis.recommendedAction}\n\n**Rollback required:** ${analysis.rollbackRequired}\n\n**GitLab issue:** ${issueLine}\n\n## Pipeline Context\n\n- Project: ${context.projectPath}\n- Ref: ${context.refName || 'n/a'}\n- Commit: ${context.commitShortSha || context.commitSha || 'n/a'}\n- Pipeline: ${context.pipelineUrl || 'n/a'}\n- Resolver job: ${context.jobUrl || 'n/a'}\n\n## Failed Jobs Analyzed\n\n${failedJobsSection}\n`;
}

function writeArtifacts({ analysis, issue, context, failedJobs }) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, formatMarkdownReport(analysis, issue, context, failedJobs));
  fs.writeFileSync(
    JSON_OUTPUT_PATH,
    JSON.stringify(
      {
        analysis,
        issue,
        failedJobs,
        context: {
          projectPath: context.projectPath,
          refName: context.refName,
          commitSha: context.commitSha,
          pipelineId: context.pipelineId,
          pipelineUrl: context.pipelineUrl,
          jobUrl: context.jobUrl,
          geminiModel: context.geminiModel
        }
      },
      null,
      2
    )
  );
}

async function main() {
  const logPath = process.argv[2] || DEFAULT_LOG_PATH;
  const context = getCiContext();
  const localLogContent = getLocalLogContent(logPath);
  const failedJobs = await fetchFailedJobs(context);
  const analysisInput = buildAnalysisInput(localLogContent, failedJobs);
  const analysis = await analyzeLogWithAI(analysisInput);
  const issue = await createGitLabIssue(analysis, context, failedJobs);

  writeArtifacts({ analysis, issue, context, failedJobs });

  console.log(`Incident report generated at: ${MARKDOWN_OUTPUT_PATH}`);
  console.log(`Incident JSON generated at: ${JSON_OUTPUT_PATH}`);

  if (issue.created) {
    console.log(`GitLab issue created: ${issue.webUrl}`);
  } else {
    console.log(`GitLab issue was not created: ${issue.reason || 'Skipped'}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`AI resolver encountered an unexpected error: ${error.message}`);

    const context = getCiContext();
    const analysis = buildMockAnalysis(error.stack || error.message || 'Unknown resolver failure.');
    const issue = {
      created: false,
      reason: 'Resolver failed unexpectedly; fallback report generated.'
    };

    writeArtifacts({ analysis, issue, context, failedJobs: [] });
    process.exitCode = 0;
  });
}

module.exports = {
  analyzeLogWithAI,
  buildAnalysisInput,
  buildIssuePayload,
  buildMockAnalysis,
  createGitLabIssue,
  formatMarkdownReport,
  getIssueLabels,
  inferSeverity,
  normalizeAnalysis,
  normalizeSeverity,
  parseAiResponse,
  titleCaseSeverity,
  writeArtifacts
};
