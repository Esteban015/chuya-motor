import { describe, it, expect } from 'vitest'
import { VehicleSchema } from './vehicle'

describe('VehicleSchema', () => {
  it('acepta un vehículo completo válido', () => {
    const result = VehicleSchema.safeParse({
      make: 'Toyota',
      model: 'Corolla',
      year: 2018,
      vehicleType: 'sedan',
      fuelType: 'gasoline',
      odometer: 95000,
      licensePlate: 'AB123CD',
    })
    expect(result.success).toBe(true)
  })

  it('acepta un objeto vacío (todos los campos son opcionales)', () => {
    const result = VehicleSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rechaza year fuera de rango', () => {
    const result = VehicleSchema.safeParse({ year: 1800 })
    expect(result.success).toBe(false)
  })

  it('rechaza make mayor a 50 caracteres', () => {
    const result = VehicleSchema.safeParse({ make: 'A'.repeat(51) })
    expect(result.success).toBe(false)
  })

  it('rechaza vehicleType desconocido', () => {
    const result = VehicleSchema.safeParse({ vehicleType: 'spaceship' })
    expect(result.success).toBe(false)
  })

  it('rechaza fuelType desconocido', () => {
    const result = VehicleSchema.safeParse({ fuelType: 'hydrogen' })
    expect(result.success).toBe(false)
  })

  it('rechaza odómetro negativo', () => {
    const result = VehicleSchema.safeParse({ odometer: -1 })
    expect(result.success).toBe(false)
  })

  it('rechaza licensePlate mayor a 10 caracteres', () => {
    const result = VehicleSchema.safeParse({ licensePlate: 'TOOLONGPLATE' })
    expect(result.success).toBe(false)
  })

  it('acepta vehículo GNC con tipo y combustible', () => {
    const result = VehicleSchema.safeParse({ fuelType: 'gnc', vehicleType: 'sedan' })
    expect(result.success).toBe(true)
  })
})

describe('VehicleSchema — límites exactos (V-01, V-02, V-04, V-06, V-07)', () => {
  it('V-01: year = 1900 es válido (límite inferior)', () => {
    expect(VehicleSchema.safeParse({ year: 1900 }).success).toBe(true)
  })

  it('V-01: year = 2100 es válido (límite superior)', () => {
    expect(VehicleSchema.safeParse({ year: 2100 }).success).toBe(true)
  })

  it('V-02: year = 2101 es rechazado (superlímite)', () => {
    expect(VehicleSchema.safeParse({ year: 2101 }).success).toBe(false)
  })

  it('V-04: model vacío es rechazado', () => {
    expect(VehicleSchema.safeParse({ model: '' }).success).toBe(false)
  })

  it('V-06: licensePlate vacía es rechazada (min 1)', () => {
    expect(VehicleSchema.safeParse({ licensePlate: '' }).success).toBe(false)
  })

  it('V-06: licensePlate de 10 caracteres es válida (límite exacto)', () => {
    expect(VehicleSchema.safeParse({ licensePlate: '1234567890' }).success).toBe(true)
  })

  it('V-07: odometer = 0 es válido', () => {
    expect(VehicleSchema.safeParse({ odometer: 0 }).success).toBe(true)
  })

  it('V-07: odometer > 2_000_000 es rechazado', () => {
    expect(VehicleSchema.safeParse({ odometer: 2_000_001 }).success).toBe(false)
  })
})
