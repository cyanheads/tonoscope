/**
 * @fileoverview Public surface of the resonance module: vessels, their standing-wave modes, the
 * special-function tables the GPU samples, and slot packing for sounding notes.
 * @module resonance
 */

export { type Excitation, MAX_SLOTS, packSlots, SLOT_FLOATS } from './excitation.ts';
export { besselJ, besselJZeros, legendreNormalized } from './special-functions.ts';
export {
  BESSEL_ORDERS,
  BESSEL_SAMPLES,
  BESSEL_X_MAX,
  buildResonance,
  evaluateRawMode,
  type Framing,
  LATTICE_FAMILIES,
  LEGENDRE_SAMPLES,
  type ModeSpec,
  type Resonance,
  tableLookup,
  tpms,
  VESSEL_KINDS,
  type Vessel,
  type VesselKind,
} from './vessels.ts';
