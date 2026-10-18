import { pool } from '../../config/db';
import { env } from '../../config/env';

export interface CloudflareUsage {
  period: {
    start: string;
    end: string;
    label: string;
    resetDate: string;
    daysRemaining: number;
    resetText: string;
  };
  storage: {
    usedBytes: number;
    usedFormatted: string;
    quotaBytes: number;
    quotaFormatted: string;
    percentage: number;
    description: string;
  };
  classA: {
    requests: number;
    formatted: string;
    freeLimit: number;
    freeLimitFormatted: string;
    percentage: number;
    description: string;
    resetsMonthly: boolean;
  };
  classB: {
    requests: number;
    formatted: string;
    freeLimit: number;
    freeLimitFormatted: string;
    percentage: number;
    description: string;
    resetsMonthly: boolean;
  };
  egress: {
    freeLimitFormatted: string;
    status: string;
  };
  cost: {
    estimatedTotal: string;
    statusText: string;
  };
  lastSyncedAt: string;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(2).replace(/\.00$/, '')}k`;
  }
  return num.toLocaleString('id-ID');
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(1)} KB`;
}

function formatResetDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

// 10 GB Free Tier quota in bytes
const R2_FREE_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
// 1 Million Free Tier requests/month for Class A
const R2_FREE_CLASS_A_LIMIT = 1_000_000;
// 10 Million Free Tier requests/month for Class B
const R2_FREE_CLASS_B_LIMIT = 10_000_000;

/**
 * Checks whether the current billing cycle has expired.
 * If expired (now >= period_end), advances the period by months and resets Class A/B operation counts to 0.
 */
async function checkAndAutoResetCycle(): Promise<{
  classA: number;
  classB: number;
  periodStart: Date;
  periodEnd: Date;
  updatedAt: Date;
}> {
  const metricsRes = await pool.query(
    `SELECT period_start, period_end, class_a_requests, class_b_requests, updated_at
     FROM r2_usage_metrics
     WHERE id = 1`
  );

  let classA = 257;
  let classB = 4720;
  let periodStart = new Date('2026-10-18T00:00:00+08:00');
  let periodEnd = new Date('2026-11-18T23:59:59+08:00');
  let updatedAt = new Date();

  if (metricsRes.rows.length > 0) {
    const row = metricsRes.rows[0];
    classA = parseInt(row.class_a_requests || '0', 10);
    classB = parseInt(row.class_b_requests || '0', 10);
    periodStart = new Date(row.period_start);
    periodEnd = new Date(row.period_end);
    updatedAt = new Date(row.updated_at);
  }

  const now = new Date();

  // If current time has reached or passed periodEnd, advance the period and reset operations to 0
  if (now.getTime() >= periodEnd.getTime()) {
    while (now.getTime() >= periodEnd.getTime()) {
      periodStart = new Date(periodEnd);
      const nextEnd = new Date(periodEnd);
      nextEnd.setMonth(nextEnd.getMonth() + 1);
      periodEnd = nextEnd;
    }
    classA = 0;
    classB = 0;
    updatedAt = now;

    await pool.query(
      `UPDATE r2_usage_metrics
       SET period_start = $1,
           period_end = $2,
           class_a_requests = 0,
           class_b_requests = 0,
           updated_at = now()
       WHERE id = 1`,
      [periodStart.toISOString(), periodEnd.toISOString()]
    );
  }

  return { classA, classB, periodStart, periodEnd, updatedAt };
}

export async function getCloudflareUsage(): Promise<CloudflareUsage> {
  // Query live total storage from ready media
  const storageRes = await pool.query(
    `SELECT COALESCE(SUM(size_bytes), 0)::text AS total_used FROM media WHERE status = 'ready'`
  );
  const usedBytes = parseInt(storageRes.rows[0]?.total_used || '0', 10);
  const storagePercentage = Math.min(100, Math.round((usedBytes / R2_FREE_STORAGE_BYTES) * 1000) / 10);

  const { classA, classB, periodStart, periodEnd, updatedAt } = await checkAndAutoResetCycle();

  // Format Indonesian date period (e.g. "18 Oktober – 18 November 2026")
  const startFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long' }).format(periodStart);
  const endFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(periodEnd);
  const periodLabel = `${startFmt} – ${endFmt}`;

  const msRemaining = Math.max(0, periodEnd.getTime() - Date.now());
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const resetDate = formatResetDate(periodEnd);
  const resetText =
    daysRemaining <= 0
      ? 'Direset hari ini'
      : daysRemaining === 1
      ? `Direset besok (${resetDate})`
      : `Direset dalam ${daysRemaining} hari (${resetDate})`;

  const classAPercent = Math.min(100, Math.round((classA / R2_FREE_CLASS_A_LIMIT) * 1000) / 10);
  const classBPercent = Math.min(100, Math.round((classB / R2_FREE_CLASS_B_LIMIT) * 1000) / 10);

  return {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      label: periodLabel,
      resetDate,
      daysRemaining,
      resetText,
    },
    storage: {
      usedBytes,
      usedFormatted: formatBytes(usedBytes),
      quotaBytes: R2_FREE_STORAGE_BYTES,
      quotaFormatted: '10 GB',
      percentage: storagePercentage,
      description: 'Kapasitas file tersimpan. Kuota gratis 10 GB aktif selamanya, tidak direset ke 0.',
    },
    classA: {
      requests: classA,
      formatted: formatNumber(classA),
      freeLimit: R2_FREE_CLASS_A_LIMIT,
      freeLimitFormatted: '1 Juta',
      percentage: classAPercent,
      description: 'Tulis, Unggah, Hapus, Pindah Folder, & Daftar Objek',
      resetsMonthly: true,
    },
    classB: {
      requests: classB,
      formatted: formatNumber(classB),
      freeLimit: R2_FREE_CLASS_B_LIMIT,
      freeLimitFormatted: '10 Juta',
      percentage: classBPercent,
      description: 'Baca, Tinjau Foto/Thumbnail, Streaming Video, & Unduh',
      resetsMonthly: true,
    },
    egress: {
      freeLimitFormatted: 'Gratis (Free Tier)',
      status: 'Tanpa Biaya Bandwidth Keluar',
    },
    cost: {
      estimatedTotal: '$0.00',
      statusText: 'No billable usage incurred yet (100% Dalam Kuota Gratis)',
    },
    lastSyncedAt: updatedAt.toISOString(),
  };
}

export async function recordClassA(count = 1): Promise<void> {
  if (count <= 0) return;
  try {
    await checkAndAutoResetCycle();
    await pool.query(
      `UPDATE r2_usage_metrics
       SET class_a_requests = class_a_requests + $1, updated_at = now()
       WHERE id = 1`,
      [count]
    );
  } catch (err) {
    console.error('Failed to record Class A operation:', err);
  }
}

export async function recordClassB(count = 1): Promise<void> {
  if (count <= 0) return;
  try {
    await checkAndAutoResetCycle();
    await pool.query(
      `UPDATE r2_usage_metrics
       SET class_b_requests = class_b_requests + $1, updated_at = now()
       WHERE id = 1`,
      [count]
    );
  } catch (err) {
    console.error('Failed to record Class B operation:', err);
  }
}
