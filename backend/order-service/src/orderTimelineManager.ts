/**
 * Order Timeline Manager
 * 
 * إدارة تسجيل الأحداث في Order Timeline & Driver History
 */

import { OrderTimelineEvent, DriverHistoryEntry, ExcludedDriver } from './types';

export class OrderTimelineManager {
  /**
   * إنشاء حدث جديد في Timeline
   */
  static createTimelineEvent(
    event: string,
    actor: string,
    actorType: 'customer' | 'driver' | 'restaurant' | 'system',
    status?: string,
    details?: Record<string, any>
  ): OrderTimelineEvent {
    return {
      timestamp: new Date().toISOString(),
      event,
      actor,
      actorType,
      status,
      details,
    };
  }

  /**
   * إضافة حدث إلى Timeline الموجود
   */
  static addEvent(
    existingTimeline: OrderTimelineEvent[] | undefined,
    event: string,
    actor: string,
    actorType: 'customer' | 'driver' | 'restaurant' | 'system',
    status?: string,
    details?: Record<string, any>
  ): OrderTimelineEvent[] {
    const timeline = existingTimeline || [];
    const newEvent = this.createTimelineEvent(event, actor, actorType, status, details);
    return [...timeline, newEvent];
  }

  /**
   * إنشاء Driver History Entry جديد عند قبول السائق للطلب
   */
  static createDriverHistoryEntry(
    driverId: string,
    driverName: string | undefined,
    driverPhone: string | undefined,
    currentStatus: string,
    holdId?: string
  ): DriverHistoryEntry {
    return {
      driverId,
      driverName,
      driverPhone,
      acceptedAt: new Date().toISOString(),
      lastStatus: currentStatus,
      holdId,
      holdReleased: false,
    };
  }

  /**
   * تحديث Driver History Entry عند فك الارتباط
   */
  static updateDriverHistoryOnUnassign(
    driverHistory: DriverHistoryEntry[] | undefined,
    driverId: string,
    lastStatus: string,
    unassignReason: string,
    holdReleased: boolean
  ): DriverHistoryEntry[] {
    const history = driverHistory || [];
    
    // ابحث عن السائق الحالي في التاريخ
    const driverIndex = history.findIndex(
      (entry) => entry.driverId === driverId && !entry.unassignedAt
    );

    if (driverIndex === -1) {
      console.warn(`⚠️ Driver ${driverId} not found in driverHistory`);
      return history;
    }

    // تحديث السجل
    const updatedEntry: DriverHistoryEntry = {
      ...history[driverIndex],
      unassignedAt: new Date().toISOString(),
      unassignReason,
      lastStatus,
      holdReleased,
    };

    // استبدال السجل القديم
    const newHistory = [...history];
    newHistory[driverIndex] = updatedEntry;
    
    return newHistory;
  }

  /**
   * الحصول على آخر سائق تم تعيينه للطلب
   */
  static getCurrentDriver(driverHistory: DriverHistoryEntry[] | undefined): DriverHistoryEntry | null {
    if (!driverHistory || driverHistory.length === 0) {
      return null;
    }

    // البحث عن سائق لم يتم فك ارتباطه بعد
    const currentDriver = driverHistory.find((entry) => !entry.unassignedAt);
    return currentDriver || null;
  }

  /**
   * الحصول على آخر حالة وصل إليها الطلب مع السائق الحالي
   */
  static getLastDriverStatus(driverHistory: DriverHistoryEntry[] | undefined): string | null {
    const currentDriver = this.getCurrentDriver(driverHistory);
    return currentDriver?.lastStatus || null;
  }

  /**
   * عدد السائقين الذين تم تعيينهم للطلب
   */
  static getDriverCount(driverHistory: DriverHistoryEntry[] | undefined): number {
    return driverHistory?.length || 0;
  }

  /**
   * هل الطلب تم إعادة تعيينه من قبل؟ (يعني هل كان له سائق سابق؟)
   */
  static wasReassigned(driverHistory: DriverHistoryEntry[] | undefined): boolean {
    return this.getDriverCount(driverHistory) > 1;
  }

  /**
   * تحديد الحالة الصحيحة للطلب بعد unassign
   * - إذا السائق ما وصل المطعم بعد → 'reassigning'
   * - إذا السائق استلم الطلب → لا يمكن unassign (يجب cancel)
   */
  static determineReassignmentEligibility(lastStatus: string): {
    canUnassign: boolean;
    reason?: string;
  } {
    // الحالات المسموحة لـ unassign
    const allowedStatuses = ['accepted', 'heading_to_store', 'arrived_at_store'];

    if (allowedStatuses.includes(lastStatus)) {
      return { canUnassign: true };
    }

    // الحالات التي لا يمكن فيها unassign
    const restrictedStatuses = ['picked_up', 'heading_to_customer', 'arrived_at_customer'];
    
    if (restrictedStatuses.includes(lastStatus)) {
      return {
        canUnassign: false,
        reason: 'لا يمكن فك الارتباط بعد استلام الطلب من المطعم. يجب إلغاء الطلب بدلاً من ذلك.',
      };
    }

    // حالات أخرى (delivered, cancelled, etc.)
    return {
      canUnassign: false,
      reason: `لا يمكن فك الارتباط في حالة ${lastStatus}`,
    };
  }

  /**
   * 🆕 إنشاء Excluded Driver Entry جديد
   * يُستخدم لمنع إعادة إرسال الطلب لنفس السائق
   */
  static createExcludedDriver(
    driverId: string,
    reason: 'unassigned' | 'rejected' | 'timeout',
    canRetryAfter?: string | null
  ): ExcludedDriver {
    return {
      driverId,
      excludedAt: new Date().toISOString(),
      reason,
      canRetryAfter: canRetryAfter || undefined,
    };
  }

  /**
   * 🆕 إضافة سائق إلى قائمة المستبعدين
   */
  static addExcludedDriver(
    existingExcluded: ExcludedDriver[] | undefined,
    driverId: string,
    reason: 'unassigned' | 'rejected' | 'timeout',
    canRetryAfter?: string | null
  ): ExcludedDriver[] {
    const excluded = existingExcluded || [];
    
    // التحقق من عدم وجوده مسبقاً
    const alreadyExcluded = excluded.find(e => e.driverId === driverId);
    if (alreadyExcluded) {
      console.log(`Driver ${driverId} already excluded from order`);
      return excluded;
    }

    const newExcluded = this.createExcludedDriver(driverId, reason, canRetryAfter);
    return [...excluded, newExcluded];
  }

  /**
   * 🆕 التحقق من أن السائق غير مستبعد
   */
  static isDriverExcluded(
    excludedDrivers: ExcludedDriver[] | undefined,
    driverId: string
  ): boolean {
    if (!excludedDrivers || excludedDrivers.length === 0) {
      return false;
    }

    const exclusion = excludedDrivers.find(e => e.driverId === driverId);
    if (!exclusion) {
      return false;
    }

    // إذا كان canRetryAfter موجود، تحقق من الوقت
    if (exclusion.canRetryAfter) {
      const retryTime = new Date(exclusion.canRetryAfter);
      const now = new Date();
      return now < retryTime; // مستبعد إذا لم يمر الوقت المطلوب
    }

    // إذا لم يكن هناك canRetryAfter، فالاستبعاد دائم
    return true;
  }

  /**
   * 🆕 الحصول على جميع السائقين المستبعدين حالياً (الاستبعاد فعّال)
   */
  static getActivelyExcludedDriverIds(
    excludedDrivers: ExcludedDriver[] | undefined
  ): string[] {
    if (!excludedDrivers || excludedDrivers.length === 0) {
      return [];
    }

    const now = new Date();
    return excludedDrivers
      .filter(e => {
        // إذا لم يكن هناك canRetryAfter، الاستبعاد دائم
        if (!e.canRetryAfter) {
          return true;
        }
        // إذا كان هناك canRetryAfter، تحقق من الوقت
        const retryTime = new Date(e.canRetryAfter);
        return now < retryTime;
      })
      .map(e => e.driverId);
  }
}
