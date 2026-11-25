/**
 * The delegators governance (CDN) payload schema. No path aliases and no database imports, so the
 * standalone bootstrap seed can import it too.
 */
import { z } from "zod";

// Column limits of delegatorsTable (name varchar 255, identity varchar 66).
export const nameSchema = z.string().min(1).max(255)
export const identitySchema = z.string().min(1).max(66)

/**
 * Shape of the delegators governance (CDN) payload. Unknown fields are stripped.
 * Use parseCdnDelegators on the fetched JSON before diffing it against the table.
 */
export const cdnDelegatorsSchema = z.array(z.object({
  name: nameSchema,
  identity: identitySchema,
  identityHistory: z.array(identitySchema),
}))

export type CdnDelegator = z.infer<typeof cdnDelegatorsSchema>[number]

/** Validates the delegators governance (CDN) payload; throws a ZodError when it is malformed. */
export function parseCdnDelegators(payload: unknown): CdnDelegator[] {
  return cdnDelegatorsSchema.parse(payload)
}
