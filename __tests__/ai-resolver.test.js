const {
  buildAnalysisInput,
  buildIssuePayload,
  buildMockAnalysis,
  parseAiResponse
} = require('../scripts/ai-resolver');

describe('AI resolver helpers', () => {
  it('classifies unit test failures as medium severity', () => {
    const analysis = buildMockAnalysis(`
      FAIL __tests__/app.test.js
      Expected: 200
      Received: 500
    `);

    expect(analysis.stepFailed).toBe('Unit Tests');
    expect(analysis.confidence).toBe('High');
    expect(analysis.severity).toBe('medium');
    expect(analysis.rollbackRequired).toBe('No');
  });

  it('classifies blue-active deploy failures as critical', () => {
    const analysis = buildMockAnalysis(`
      smoke_test_blue_active failed
      healthcheck returned status 500
      blue-active service is not healthy
    `);

    expect(analysis.stepFailed).toBe('Blue Active Smoke Test');
    expect(analysis.rollbackRequired).toBe('Yes');
    expect(analysis.severity).toBe('critical');
  });

  it('builds a gitlab issue payload with severity labels and the configured model', () => {
    const analysis = {
      stepFailed: 'Green Preview Smoke Test',
      probableRootCause: 'Preview service did not become healthy.',
      confidence: 'Medium',
      suggestedFix: 'Review rollout readiness and container logs.',
      recommendedAction: 'Inspect the preview deployment before promotion.',
      rollbackRequired: 'No',
      severity: 'high'
    };

    const payload = buildIssuePayload(analysis, {
      geminiModel: 'gemini-2.5-flash',
      projectPath: 'group/dev-cicd-challenge',
      refName: 'main',
      commitShortSha: 'abc12345',
      commitSha: 'abc12345deadbeef',
      pipelineUrl: 'https://gitlab.example/pipelines/1',
      jobUrl: 'https://gitlab.example/jobs/1'
    }, [
      {
        name: 'smoke_test_green_preview',
        stage: 'smoke_green',
        webUrl: 'https://gitlab.example/jobs/2'
      }
    ]);

    expect(payload.title).toContain('[High]');
    expect(payload.description).toContain('**AI model:** gemini-2.5-flash');
    expect(payload.labels).toEqual(expect.arrayContaining(['ai-resolver', 'pipeline-failure', 'severity::high', 'deploy']));
  });

  it('parses structured AI JSON responses and preserves severity', () => {
    const analysis = parseAiResponse(JSON.stringify({
      stepFailed: 'Deploy Validation',
      probableRootCause: 'The rollout manifest references an invalid image tag.',
      confidence: 'medium',
      suggestedFix: 'Publish the image and update the manifest.',
      recommendedAction: 'Retry the deploy after fixing the image reference.',
      rollbackRequired: 'no',
      severity: 'high'
    }), 'deploy failed');

    expect(analysis.stepFailed).toBe('Deploy Validation');
    expect(analysis.confidence).toBe('Medium');
    expect(analysis.severity).toBe('high');
    expect(analysis.rollbackRequired).toBe('No');
  });

  it('includes failed job traces and local fallback logs in the AI prompt input', () => {
    const promptInput = buildAnalysisInput('local fallback log', [
      {
        name: 'smoke_test_blue_active',
        stage: 'smoke_blue',
        webUrl: 'https://gitlab.example/jobs/9',
        traceExcerpt: 'healthcheck returned status 500'
      }
    ]);

    expect(promptInput).toContain('Failed job 1: smoke_test_blue_active');
    expect(promptInput).toContain('healthcheck returned status 500');
    expect(promptInput).toContain('Fallback local log:');
    expect(promptInput).toContain('local fallback log');
  });
});