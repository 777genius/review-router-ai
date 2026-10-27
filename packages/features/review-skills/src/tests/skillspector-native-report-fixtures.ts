// Captured from actual pinned SkillSpector 2.13.1 executions on 2026-10-27.
// Only policy-consumed native fields are retained; values are not synthesized.
// AI execution used the scanner service with a local, non-billable provider fixture.
export const capturedNativeSkillSpectorReports = {
  clear: {
    execution_successful: true,
    analysis_completeness: {
      execution_successful: true,
      is_complete: true,
      status: "complete",
    },
    metadata: {
      skillspector_version: "2.13.1",
      llm_requested: false,
      llm_available: false,
      inference_usage: [],
    },
    risk_assessment: {
      max_issue_severity: "NONE",
      recommendation: "SAFE",
      score: 0,
      severity: "LOW",
    },
    issues: [],
  },
  warnings: {
    execution_successful: true,
    analysis_completeness: {
      execution_successful: true,
      is_complete: true,
      status: "complete",
    },
    metadata: {
      skillspector_version: "2.13.1",
      llm_requested: false,
      llm_available: false,
      inference_usage: [],
    },
    risk_assessment: {
      max_issue_severity: "MEDIUM",
      recommendation: "SAFE",
      score: 8,
      severity: "LOW",
    },
    issues: [
      {
        severity: "MEDIUM",
        explanation:
          "Skill grants unrestricted tool access without appropriate constraints. An agent with unfettered tool access can perform arbitrary actions including file modification, network requests, and code execution.",
        remediation:
          "Restrict tool access to only the tools required for the skill's stated purpose. Use an explicit allowlist rather than granting blanket access.",
        location: {
          end_line: null,
          file: "SKILL.md",
          start_column: 0,
          start_line: 5,
        },
      },
    ],
  },
  blocked: {
    execution_successful: true,
    analysis_completeness: {
      execution_successful: true,
      is_complete: true,
      status: "complete",
    },
    metadata: {
      skillspector_version: "2.13.1",
      llm_requested: false,
      llm_available: false,
      inference_usage: [],
    },
    risk_assessment: {
      max_issue_severity: "HIGH",
      recommendation: "SAFE",
      score: 20,
      severity: "LOW",
    },
    issues: [
      {
        severity: "HIGH",
        explanation:
          "This pattern attempts to override system instructions or ignore safety constraints. Without LLM analysis, manual review is recommended.",
        remediation:
          "Remove or rewrite any text that instructs the agent to ignore prompts, override safety rules, or trust unverified content. Ensure skill content cannot be injected to alter agent behavior.",
        location: {
          end_column: 32,
          end_line: 5,
          file: "SKILL.md",
          start_column: 0,
          start_line: 5,
        },
      },
    ],
  },
  ai: {
    execution_successful: true,
    analysis_completeness: {
      execution_successful: true,
      is_complete: true,
      status: "complete",
    },
    metadata: {
      skillspector_version: "2.13.1",
      llm_requested: true,
      llm_available: true,
      llm_calls_attempted: 3,
      llm_calls_succeeded: 3,
      inference_usage: [
        {
          node: "semantic_developer_intent",
          request_kind: "structured_output",
          provider: "openai_compatible",
          model: "fixture-model",
          model_source: "requested_model",
          usage_source: "provider_response",
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
        },
        {
          node: "semantic_quality_policy",
          request_kind: "structured_output",
          provider: "openai_compatible",
          model: "fixture-model",
          model_source: "requested_model",
          usage_source: "provider_response",
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
        },
        {
          node: "semantic_security_discovery",
          request_kind: "structured_output",
          provider: "openai_compatible",
          model: "fixture-model",
          model_source: "requested_model",
          usage_source: "provider_response",
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
        },
      ],
    },
    risk_assessment: {
      score: 0,
      severity: "LOW",
      recommendation: "SAFE",
      max_issue_severity: "NONE",
    },
    issues: [],
  },
} as const;
