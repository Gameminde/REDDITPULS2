/**
 * Process Limiter — prevents resource exhaustion from concurrent Python processes.
 * Max 2 concurrent processes per user. Used by scan, validate, and report routes.
 */

const activeProcesses = new Map<string, number>();
const MAX_CONCURRENT = 2;

/**
 * Check if user can start a new process.
 */
export function checkProcessLimit(userId: string): boolean {
    const count = activeProcesses.get(userId) || 0;
    return count < MAX_CONCURRENT;
}

/**
 * Track a new process for a user.
 */
export function trackProcess(userId: string): void {
    const count = activeProcesses.get(userId) || 0;
    activeProcesses.set(userId, count + 1);
}

/**
 * Release a process slot when it completes.
 */
export function releaseProcess(userId: string): void {
    const count = activeProcesses.get(userId) || 0;
    if (count <= 1) {
        activeProcesses.delete(userId);
    } else {
        activeProcesses.set(userId, count - 1);
    }
}

/**
 * Get current process count for a user (for debugging/monitoring).
 */
export function getProcessCount(userId: string): number {
    return activeProcesses.get(userId) || 0;
}
