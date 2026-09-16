import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveAnalysisDisplayStatus,
  deriveRunDisplayStatus,
} from '../../src/db/display-status'

test('run display status follows operator-facing precedence', () => {
  assert.equal(deriveRunDisplayStatus({
    status: 'manually_copied',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: false,
    hasActiveTransfer: false,
  }), 'Ready')
  assert.equal(deriveRunDisplayStatus({
    status: 'transferred',
    hasIndexedAnalysis: true,
    hasBlockedAnalysis: true,
    hasActiveTransfer: true,
  }), 'Ready')
  assert.equal(deriveRunDisplayStatus({
    status: 'blocked',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: false,
    hasActiveTransfer: true,
  }), 'Blocked')
  assert.equal(deriveRunDisplayStatus({
    status: 'transferred',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: true,
    hasActiveTransfer: true,
  }), 'Blocked')
  assert.equal(deriveRunDisplayStatus({
    status: 'run_complete',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: false,
    hasActiveTransfer: true,
  }), 'Transferring')
  assert.equal(deriveRunDisplayStatus({
    status: 'running',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: false,
    hasActiveTransfer: false,
  }), 'Running')
})

test('analysis display status follows indexed, blocked, activity precedence', () => {
  assert.equal(deriveAnalysisDisplayStatus({ status: 'indexed', hasActiveTransfer: true }), 'Ready')
  assert.equal(deriveAnalysisDisplayStatus({ status: 'blocked', hasActiveTransfer: true }), 'Blocked')
  assert.equal(deriveAnalysisDisplayStatus({ status: 'analysis_complete', hasActiveTransfer: true }), 'Transferring')
  assert.equal(deriveAnalysisDisplayStatus({ status: 'running', hasActiveTransfer: false }), 'Running')
})
