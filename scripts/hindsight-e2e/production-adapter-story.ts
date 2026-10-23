import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HindsightMemoryProvider } from '../../packages/features/memory/src/infrastructure/hindsight/hindsight-memory-provider.ts';
import { HINDSIGHT_MEMORY_PROFILE } from '../../packages/features/memory/src/infrastructure/config/memory-provider-config.ts';
import { normalizeMemoryBody } from '../../packages/features/memory/src/domain/memory-body.ts';
import type { MemoryKnowledgeCommand, MemoryKnowledgeScope } from '../../packages/features/memory/src/domain/memory-knowledge.ts';
import type { MemoryKnowledgeWriter, MemoryProviderEntry } from '../../packages/features/memory/src/application/ports/memory-knowledge-provider-port.ts';
import { eventually } from './native-runtime.ts';

type Delivery = Parameters<MemoryKnowledgeWriter['submit']>[0];

/** Actual production SDK adapter talking to the real native API/worker/PG. */
export async function qualifyProductionAdapter(baseUrl: string, apiKey: string, run: string) {
  const generation = `${run}-adapter`;
  const provider = new HindsightMemoryProvider({ kind: 'hindsight', generation, profileVersion: HINDSIGHT_MEMORY_PROFILE, baseUrl, apiKey, namespace: 'native-qualification' });
  const controls = () => ({ deadlineAt: new Date(Date.now() + 20_000) });
  const sourceTime = '2026-01-02T03:04:05Z';
  const workspace: MemoryKnowledgeScope = { kind: 'workspace', workspaceId: `${run}-workspace-a` };
  const repository: MemoryKnowledgeScope = { kind: 'repository', workspaceId: workspace.workspaceId, repositoryId: `${run}-repo-a` };
  const secondRepository: MemoryKnowledgeScope = { kind: 'repository', workspaceId: workspace.workspaceId, repositoryId: `${run}-repo-b` };
  const otherWorkspace: MemoryKnowledgeScope = { kind: 'workspace', workspaceId: `${run}-workspace-b` };
  const preference: MemoryKnowledgeScope = { kind: 'user_preference', workspaceId: workspace.workspaceId, userId: 'private-user-a' };
  function save(scope: MemoryKnowledgeScope, entryId: string, body: string): Delivery {
    return { command: { kind: 'save', ref: { type: 'entry', scope, entryId }, commandId: randomUUID(), expectedRevision: null, generation, providerProfileVersion: HINDSIGHT_MEMORY_PROFILE, approval: { actor: { kind: 'workspace_user', id: 'synthetic-authorized-actor', githubUserId: null, login: null }, approvedAt: '2026-02-01T00:00:00.000Z', authorityRevision: 'qualification-authority-v1' }, body: normalizeMemoryBody(body), knowledgeKind: 'rule', topicIds: ['transactions'], source: { type: 'manual', sourceId: `manual-${entryId}`, revision: '1', updatedAt: sourceTime, statementAt: sourceTime, repositoryId: scope.kind === 'repository' ? scope.repositoryId : null, pullRequestNumber: null, url: null, visibility: 'private', claimedBodyDigest: null, observedCommitSha: null }, applicability: { validUntil: null, observedCommitSha: null, exceptionRule: null }, temporalMode: 'preserve_original' }, revision: '1', contentApprovalRevision: '1', originalStatementAt: null, allowResubmit: true, resubmitUntil: new Date(Date.now() + 120_000).toISOString() };
  }
  async function publish(delivery: Delivery): Promise<MemoryProviderEntry> {
    assert.equal((await provider.submit(delivery, controls())).state, 'submitted');
    return await eventually(async () => {
      const operation = await provider.observe(delivery, controls());
      assert(!['failed', 'unknown'].includes(operation.state), 'Actual production adapter failed native publication/readback');
      return operation.state === 'published' ? operation.verifiedEntry : undefined;
    }, 'actual production adapter publication', 120_000);
  }
  const initial = save(repository, `${run}-adapter-entry`, 'Use transactional writes for ревью. Preserve explicit approvals.');
  const entry = await publish(initial);
  assert.equal(entry.body, initial.command.kind === 'save' ? initial.command.body : '');
  assert.equal(entry.statementAt, '2026-01-02T03:04:05.000Z');
  assert(entry.sourceFactIds.length > 0);
  await provider.submit(initial, controls());
  const repeated = await provider.read(initial.command.ref, controls());
  assert.deepEqual(repeated?.sourceFactIds, entry.sourceFactIds);
  const listed = await provider.list({ scope: repository, limit: 10 }, controls());
  assert(listed.entries.some(candidate => candidate.ref.entryId === entry.ref.entryId));
  const recalled = await provider.recall({ scope: repository, query: 'transactional writes', limit: 5, includeHistoricalObservations: false }, controls());
  assert(recalled.some(candidate => candidate.type === 'entry' && candidate.entry.ref.entryId === entry.ref.entryId));
  assert.equal(await provider.read({ ...initial.command.ref, scope: otherWorkspace }, controls()), null);
  assert.equal(await provider.read({ ...initial.command.ref, scope: secondRepository }, controls()), null);
  const probes = [save(workspace, `${run}-shared`, 'Workspace shared approved rule marker SHARED_A.'), save(secondRepository, `${run}-repo-b-only`, 'Repository B approved rule marker REPO_B_ONLY.'), save(otherWorkspace, `${run}-other-workspace`, 'Other workspace approved marker WORKSPACE_B_ONLY.'), save(preference, `${run}-preference`, 'Private preference marker USER_A_ONLY.')];
  for (const probe of probes) await publish(probe);
  const privateProbe = probes[3]!;
  for (const selected of [workspace, repository, secondRepository, otherWorkspace]) {
    assert.equal(await provider.read({ ...privateProbe.command.ref, scope: selected }, controls()), null);
    const results = await provider.recall({ scope: selected, query: 'USER_A_ONLY WORKSPACE_B_ONLY REPO_B_ONLY', limit: 10, includeHistoricalObservations: true }, controls());
    const text = JSON.stringify(results);
    assert(!text.includes('USER_A_ONLY'));
    if (selected !== otherWorkspace) assert(!text.includes('WORKSPACE_B_ONLY'));
    if (selected !== secondRepository) assert(!text.includes('REPO_B_ONLY'));
  }
  assert(initial.command.kind === 'save');
  const reapproval: Delivery = { ...initial, command: { ...initial.command, commandId: randomUUID(), expectedRevision: '1', source: { ...initial.command.source, revision: '2', updatedAt: '2026-09-01T00:00:00Z', statementAt: '2026-09-01T00:00:00Z' } }, revision: '2', originalStatementAt: entry.statementAt };
  const unchanged = await publish(reapproval);
  assert.equal(unchanged.statementAt, entry.statementAt); assert.deepEqual(unchanged.sourceFactIds, entry.sourceFactIds);
  const replacement: Delivery = { ...initial, command: { ...initial.command, commandId: randomUUID(), expectedRevision: '2', body: 'Use the current replacement transaction rule.', source: { ...initial.command.source, revision: '3', updatedAt: '2026-09-02T00:00:00Z', statementAt: '2026-09-02T00:00:00Z' } }, revision: '3', contentApprovalRevision: '2' };
  const replaced = await publish(replacement); assert.equal(replaced.body, 'Use the current replacement transaction rule.');
  const topics: Delivery = { ...replacement, command: { ...replacement.command, kind: 'topics', commandId: randomUUID(), expectedRevision: '3', topicIds: ['moved'] }, revision: '4', originalStatementAt: replaced.statementAt };
  const topicOperation = await provider.submit(topics, controls()); assert.equal(topicOperation.state, 'published'); assert.deepEqual(topicOperation.verifiedEntry?.topicIds, ['moved']);
  const retire: Delivery = { ...topics, command: { ...topics.command, kind: 'retire', commandId: randomUUID(), expectedRevision: '4' } as MemoryKnowledgeCommand, revision: '5' };
  assert.equal((await provider.submit(retire, controls())).state, 'completed');
  assert.equal((await provider.read(retire.command.ref, controls()))?.body, replaced.body, 'Retired management body disappeared');
  const afterRetire = await provider.recall({ scope: repository, query: 'current replacement transaction rule', limit: 5, includeHistoricalObservations: false }, controls());
  assert(!afterRetire.some(candidate => candidate.type === 'entry' && candidate.entry.ref.entryId === entry.ref.entryId));
  const forget: Delivery = { ...retire, command: { ...retire.command, kind: 'forget', commandId: randomUUID(), expectedRevision: '5' }, revision: '6' };
  assert.equal((await provider.submit(forget, controls())).state, 'cleanup_pending');
  assert.equal((await provider.observe(forget, controls())).state, 'cleanup_pending');
  return { checkpoints: ['actual-production-adapter-native-save-read-list-recall', 'actual-production-adapter-native-uuid-retry-time-and-replacement', 'actual-production-adapter-native-workspace-repository-private-user-isolation', 'actual-production-adapter-native-topic-retire-retained-management-body', 'actual-production-adapter-forget-honestly-pending-operator-proof'], commands: 11, sdkVersion: '1.1.0' };
}
