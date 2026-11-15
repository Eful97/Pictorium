import type { StyleGroup } from "@/lib/badge-style-groups"

/**
 * Member a family tile previews: the active value when it belongs to the
 * family, else the member the user picked last in this mount, else the first.
 */
export function familyMember(group: StyleGroup, value: string | null | undefined, memory: Readonly<Record<string, string>>): string {
  if (value && group.members.includes(value)) return value
  const remembered = memory[group.id]
  return remembered && group.members.includes(remembered) ? remembered : group.members[0]
}

/** Member a click lands on: the candidate, else the first non-disabled member (null when all are disabled). */
export function enabledFamilyMember(group: StyleGroup, candidate: string, disabled?: readonly string[]): string | null {
  if (!disabled?.includes(candidate)) return candidate
  return group.members.find((m) => !disabled.includes(m)) ?? null
}
