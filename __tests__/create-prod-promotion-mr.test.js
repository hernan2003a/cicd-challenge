const {
  buildMergeRequestPayload,
  buildPromotionBranchName,
  extractImageFromManifest
} = require('../scripts/create-prod-promotion-mr');

describe('create-prod-promotion-mr helpers', () => {
  it('builds the expected promotion branch name', () => {
    expect(buildPromotionBranchName('abc12345')).toBe('promote-prod-abc12345');
    expect(buildPromotionBranchName('abc12345', 'release-prod')).toBe('release-prod-abc12345');
  });

  it('extracts the image reference from a rollout manifest', () => {
    const image = extractImageFromManifest(`
apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  template:
    spec:
      containers:
      - name: app
        image: registry.infra-tools.svc.cluster.local:5000/cicd-challenge:abc12345
`);

    expect(image).toBe('registry.infra-tools.svc.cluster.local:5000/cicd-challenge:abc12345');
  });

  it('builds a merge request payload that explains the prod promotion', () => {
    const payload = buildMergeRequestPayload({
      commitSha: 'abc12345deadbeef',
      commitShortSha: 'abc12345',
      buildBranch: 'build',
      stageBranch: 'stage',
      prodBranch: 'prod',
      projectUrl: 'https://gitlab.example/dev-cicd-challenge',
      pipelineUrl: 'https://gitlab.example/pipelines/1',
      sourceBranch: 'promote-prod-abc12345',
      targetBranch: 'prod'
    }, 'registry.infra-tools.svc.cluster.local:5000/cicd-challenge:abc12345');

    expect(payload.title).toBe('Promote abc12345 from stage to prod');
    expect(payload.description).toContain('generated automatically after the complete stage validation finished successfully');
    expect(payload.description).toContain('Build branch: build');
    expect(payload.description).toContain('Prod branch: prod');
    expect(payload.description).toContain('registry.infra-tools.svc.cluster.local:5000/cicd-challenge:abc12345');
    expect(payload.remove_source_branch).toBe(true);
    expect(payload.labels).toBe('promotion,prod,env::prod');
  });
});