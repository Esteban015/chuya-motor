import { z } from 'zod'

export const VehicleTypeSchema = z.enum(['sedan', 'hatchback', 'suv', 'pickup', 'van', 'motorcycle', 'other'])
export type VehicleType = z.infer<typeof VehicleTypeSchema>

export const FuelTypeSchema = z.enum(['gasoline', 'diesel', 'gnc', 'hybrid', 'electric', 'other'])
export type FuelType = z.infer<typeof FuelTypeSchema>

/**
 * Vehicle IDENTIFICATION level (7D.1, redefined in 7D.2). ALWAYS computed on the server
 * (vehicle-validation.ts), never accepted from the client. It says how well we know WHICH vehicle
 * it is — it NEVER certifies that a part fits (no level means "compatible").
 *   - identity_full:     type, brand, model, year AND version belong together and the source lists
 *                        them consistently (year listed for that version);
 *   - identity_basic:    type, brand and model verified; year and/or version not confirmed (not
 *                        given, "no sé", or the source has no year data);
 *   - identity_partial:  only type, or type + brand, verified; the rest is declared;
 *   - identity_conflict: the catalog contradicts the data (year not listed for the model or
 *                        version, declared fuel ≠ version fuel, version listed inconsistently by
 *                        the source);
 *   - user_declared:     typed by hand, catalog unavailable, or IDs that do not belong together.
 */
export const VehicleValidationSchema = z.enum(['identity_full', 'identity_basic', 'identity_partial', 'identity_conflict', 'user_declared'])
export type VehicleValidation = z.infer<typeof VehicleValidationSchema>

export const VehicleCatalogProvenanceSchema = z.object({
  source: z.string().min(1).max(40),
  version: z.string().min(1).max(60),
  isFixture: z.boolean(),
  typeId: z.string().max(70).optional(),
  brandId: z.string().max(70).optional(),
  modelId: z.string().max(70).optional(),
  versionId: z.string().max(70).optional(),
})
export type VehicleCatalogProvenance = z.infer<typeof VehicleCatalogProvenanceSchema>

export const VehicleSchema = z.object({
  make: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  vehicleType: VehicleTypeSchema.optional(),
  fuelType: FuelTypeSchema.optional(),
  odometer: z.number().int().nonnegative().max(2_000_000).optional(),
  licensePlate: z.string().min(1).max(10).optional(),
  // ── 7D.1 (additive, optional) ──
  /** Engine as declared by the person or as the catalog version names it. Never inferred. */
  engine: z.string().min(1).max(80).optional(),
  /** Version label exactly as listed by the catalog. */
  version: z.string().min(1).max(120).optional(),
  /** Where `engine` / `fuelType` came from. */
  engineSource: z.enum(['catalog', 'declared']).optional(),
  fuelSource: z.enum(['catalog', 'declared']).optional(),
  validation: VehicleValidationSchema.optional(),
  catalog: VehicleCatalogProvenanceSchema.optional(),
})
export type Vehicle = z.infer<typeof VehicleSchema>
