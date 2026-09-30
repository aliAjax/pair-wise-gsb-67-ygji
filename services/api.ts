import { ofetch } from 'ofetch'
import type { EquipmentNode } from '../types/domain'

const apiBase = () => (import.meta.client ? (window as unknown as { __NUXT_API_BASE__?: string }).__NUXT_API_BASE__ : undefined)
const client = ofetch.create({ baseURL: apiBase() || '/api', timeout: 5000 })

export async function loadEquipmentSnapshot(fallback: EquipmentNode[]): Promise<EquipmentNode[]> {
  if (!apiBase()) return fallback
  try { return await client<EquipmentNode[]>('/acceptance/equipment') } catch { return fallback }
}

export async function validateEvidencePackage(payload: unknown) {
  if (!apiBase()) return { accepted: true, packageId: `LOCAL-${Date.now()}` }
  return client<{ accepted: boolean; packageId: string }>('/acceptance/validate-package', { method: 'POST', body: payload as Record<string, unknown> })
}
