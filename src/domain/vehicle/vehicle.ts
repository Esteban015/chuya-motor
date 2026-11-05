import { z } from 'zod'

export const VehicleTypeSchema = z.enum(['sedan', 'hatchback', 'suv', 'pickup', 'van', 'motorcycle', 'other'])
export type VehicleType = z.infer<typeof VehicleTypeSchema>

export const FuelTypeSchema = z.enum(['gasoline', 'diesel', 'gnc', 'hybrid', 'electric', 'other'])
export type FuelType = z.infer<typeof FuelTypeSchema>

export const VehicleSchema = z.object({
  make: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  vehicleType: VehicleTypeSchema.optional(),
  fuelType: FuelTypeSchema.optional(),
  odometer: z.number().int().nonnegative().max(2_000_000).optional(),
  licensePlate: z.string().min(1).max(10).optional(),
})
export type Vehicle = z.infer<typeof VehicleSchema>
