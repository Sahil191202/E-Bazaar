import mongoose from 'mongoose';

// Standalone address model (for saved addresses outside user embedded docs)
// Used for vendor pickup addresses, agent home base, etc.
const addressSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label:     { type: String, default: 'Home', trim: true },
  fullName:  { type: String, required: true, trim: true },
  phone:     { type: String, required: true, trim: true },
  line1:     { type: String, required: true, trim: true },
  line2:     { type: String, default: '', trim: true },
  city:      { type: String, required: true, trim: true },
  state:     { type: String, required: true, trim: true },
  pincode:   { type: String, required: true, trim: true },
  country:   { type: String, default: 'India' },
  isDefault: { type: Boolean, default: false },
  lat:       { type: Number, default: null },
  lng:       { type: Number, default: null },
}, { timestamps: true });

addressSchema.index({ user: 1 });

export const Address = mongoose.model('Address', addressSchema);