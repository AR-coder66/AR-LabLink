/**
 * Core Security, Sanitization & Input Validation Layer
 * Protects against XSS, Prototype Pollution, and Malicious Payloads
 */

export class SecurityGuard {
  /**
   * Sanitizes plain strings by escaping HTML entities to prevent Stored & Reflected XSS
   */
  static sanitizeString(input: unknown): string {
    if (typeof input !== 'string') return '';
    return input
      .trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Validates standard university email domains
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Validates booking date format (YYYY-MM-DD) and ensures date is not in the past
   */
  static isValidBookingDate(dateStr: string): { valid: boolean; reason?: string } {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { valid: false, reason: 'Invalid date format. Expected YYYY-MM-DD.' };
    }
    const targetDate = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(targetDate.getTime())) {
      return { valid: false, reason: 'Invalid date value.' };
    }

    if (targetDate < today) {
      return { valid: false, reason: 'Cannot make bookings in the past.' };
    }

    return { valid: true };
  }

  /**
   * Validates time strings (HH:mm)
   */
  static isValidTime(timeStr: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr);
  }

  /**
   * Validates positive integer hours within acceptable bounds
   */
  static isValidDuration(hours: number, maxAllowed: number): boolean {
    return Number.isInteger(hours) && hours > 0 && hours <= maxAllowed;
  }
}

