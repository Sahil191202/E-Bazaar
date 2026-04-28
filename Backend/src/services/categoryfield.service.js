import { CategoryField } from '../models/CategoryField.js';
import { ApiError }       from '../utils/ApiError.js';

/**
 * CategoryFieldService
 *
 * Handles all business logic around category-level custom fields:
 *  - Fetching active fields for a category (with ancestor inheritance)
 *  - Validating a listing's customFields payload against the schema
 */
export class CategoryFieldService {

  /**
   * Get all active custom fields for a category.
   * Also pulls in inherited fields from parent categories (ancestors).
   *
   * @param {string|ObjectId} categoryId
   * @param {string[]} ancestorIds  — from Category.ancestors
   * @returns {CategoryField[]}
   */
  static async getFieldsForCategory(categoryId, ancestorIds = []) {
    const categoryIds = [...ancestorIds.map(String), String(categoryId)];

    const fields = await CategoryField.find({
      category: { $in: categoryIds },
      isActive:  true,
    })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    return fields;
  }

  /**
   * Validate a `customFields` map submitted by a vendor when creating/updating a listing.
   * Throws ApiError if required fields are missing or values are invalid.
   *
   * @param {Object}            customFields  — { field_key: value, … }
   * @param {CategoryField[]}   fieldDefs     — from getFieldsForCategory()
   * @returns {Object}  sanitized & validated customFields map
   */
  static validateCustomFields(customFields = {}, fieldDefs = []) {
    const result  = {};
    const errors  = [];

    for (const field of fieldDefs) {
      const raw       = customFields[field.key];
      const isEmpty   = raw === undefined || raw === null || raw === '';

      // ── Required check ──────────────────────────────────────────────────────
      if (field.isRequired && isEmpty) {
        errors.push(`"${field.label}" is required`);
        continue;
      }

      // Skip optional empty fields — don't store them
      if (isEmpty) continue;

      // ── Type-specific validation ────────────────────────────────────────────
      switch (field.fieldType) {

        case 'text': {
          if (typeof raw !== 'string') { errors.push(`"${field.label}" must be a string`); break; }
          if (field.minLength && raw.length < field.minLength)
            errors.push(`"${field.label}" must be at least ${field.minLength} characters`);
          if (field.maxLength && raw.length > field.maxLength)
            errors.push(`"${field.label}" must be at most ${field.maxLength} characters`);
          result[field.key] = raw.trim();
          break;
        }

        case 'textarea': {
          if (typeof raw !== 'string') { errors.push(`"${field.label}" must be a string`); break; }
          if (field.minLength && raw.length < field.minLength)
            errors.push(`"${field.label}" must be at least ${field.minLength} characters`);
          if (field.maxLength && raw.length > field.maxLength)
            errors.push(`"${field.label}" must be at most ${field.maxLength} characters`);
          result[field.key] = raw.trim();
          break;
        }

        case 'number': {
          const num = Number(raw);
          if (isNaN(num)) { errors.push(`"${field.label}" must be a number`); break; }
          if (field.minValue !== null && num < field.minValue)
            errors.push(`"${field.label}" must be ≥ ${field.minValue}`);
          if (field.maxValue !== null && num > field.maxValue)
            errors.push(`"${field.label}" must be ≤ ${field.maxValue}`);
          result[field.key] = num;
          break;
        }

        case 'dropdown':
        case 'radio': {
          const validValues = field.options.map((o) => o.value);
          if (!validValues.includes(String(raw))) {
            errors.push(`"${field.label}" must be one of: ${validValues.join(', ')}`);
            break;
          }
          result[field.key] = String(raw);
          break;
        }

        case 'checkbox': {
          // Accepts array OR comma-separated string
          let values = Array.isArray(raw) ? raw : String(raw).split(',').map((v) => v.trim());
          const validValues = field.options.map((o) => o.value);
          const invalid = values.filter((v) => !validValues.includes(v));
          if (invalid.length) {
            errors.push(`"${field.label}" contains invalid options: ${invalid.join(', ')}`);
            break;
          }
          result[field.key] = values;
          break;
        }

        case 'boolean': {
          if (!['true', 'false', true, false, 1, 0].includes(raw)) {
            errors.push(`"${field.label}" must be true or false`);
            break;
          }
          result[field.key] = raw === true || raw === 'true' || raw === 1;
          break;
        }

        case 'date': {
          const d = new Date(raw);
          if (isNaN(d.getTime())) { errors.push(`"${field.label}" must be a valid date`); break; }
          result[field.key] = d.toISOString().split('T')[0]; // Store as YYYY-MM-DD
          break;
        }

        default:
          result[field.key] = raw;
      }
    }

    if (errors.length) {
      throw new ApiError(422, 'Custom field validation failed', errors);
    }

    return result;
  }
}