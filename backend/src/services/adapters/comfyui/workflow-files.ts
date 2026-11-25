/** 读写 workspace/comfyui/<kind>.json */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeWorkflow, type Workflow } from './resolve-nodes.js'
import bundledT2I from './t2i.json'
import bundledI2I from './i2i.json'
import bundledI2V from './i2v.json'
import bundledI2VCloud from './i2v-cloud.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type ComfyWorkflowKind = 't2i' | 'i2i' | 'i2v' | 'i2v_cloud'

const KIND_FILE: Record<ComfyWorkflowKind, string> = {
  t2i: 't2i.json',
  i2i: 'i2i.json',
  i2v: 'i2v.json',
  i2v_cloud: 'i2v-cloud.json',
}

export function workspaceRoot() {
  return process.env.WORKSPACE_PATH
    ? path.resolve(process.env.WORKSPACE_PATH)
    : path.resolve(__dirname, '../../../../workspace')
}

export function workflowPath(kind: ComfyWorkflowKind) {
  return path.join(workspaceRoot(), 'comfyui', KIND_FILE[kind])
}

export function loadComfyWorkflow(kind: ComfyWorkflowKind): Workflow {
  const overridePath = workflowPath(kind)
  try {
    if (fs.existsSync(overridePath)) {
      return normalizeWorkflow(JSON.parse(fs.readFileSync(overridePath, 'utf8')))
    }
  } catch (err: any) {
    throw new Error(`读取工作区 ComfyUI 工作流失败（${overridePath}）: ${err?.message || err}`)
  }
  if (kind === 't2i') return normalizeWorkflow(structuredClone(bundledT2I))
  if (kind === 'i2i') return normalizeWorkflow(structuredClone(bundledI2I))
  if (kind === 'i2v') return normalizeWorkflow(structuredClone(bundledI2V))
  if (kind === 'i2v_cloud') return normalizeWorkflow(structuredClone(bundledI2VCloud))
  throw new Error(`未知 ComfyUI 工作流类型: ${kind}`)
}
