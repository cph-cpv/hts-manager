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
  }), 'Ready')
  assert.equal(deriveRunDisplayStatus({
    status: 'transferred',
    hasIndexedAnalysis: true,
    hasBlockedAnalysis: true,
  }), 'Ready')
  assert.equal(deriveRunDisplayStatus({
    status: 'blocked',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: false,
  }), 'Blocked')
  assert.equal(deriveRunDisplayStatus({
    status: 'transferred',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: true,
  }), 'Blocked')
  assert.equal(deriveRunDisplayStatus({
    status: 'processing',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: false,
  }), 'Processing')
  assert.equal(deriveRunDisplayStatus({
    status: 'transferred',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: false,
  }), 'Processing')
  assert.equal(deriveRunDisplayStatus({
    status: 'sequencing',
    hasIndexedAnalysis: false,
    hasBlockedAnalysis: false,
  }), 'Sequencing')
})

test('analysis display status collapses internal progress states', () => {
  assert.equal(deriveAnalysisDisplayStatus({ status: 'indexed' }), 'Ready')
  assert.equal(deriveAnalysisDisplayStatus({ status: 'blocked' }), 'Blocked')
  assert.equal(deriveAnalysisDisplayStatus({ status: 'running' }), 'Processing')
  assert.equal(deriveAnalysisDisplayStatus({ status: 'analysis_complete' }), 'Processing')
  assert.equal(deriveAnalysisDisplayStatus({ status: 'transferred' }), 'Processing')
})
