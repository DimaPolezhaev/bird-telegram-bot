// lib/sentry.js
import * as Sentry from "@sentry/node";

/**
 * Инициализирует Sentry для мониторинга ошибок
 */
export function initSentry() {
    const dsn = process.env.SENTRY_DSN;

    if (!dsn) {
        console.log("⚠️ Sentry DSN не найден. Мониторинг ошибок отключен.");
        return;
    }

    Sentry.init({
        dsn: dsn,
        tracesSampleRate: 1.0,
        environment: process.env.NODE_ENV || "development",
    });

    console.log("🚀 Sentry инициализирован успешно.");
}

/**
 * Отправляет ошибку в Sentry с дополнительным контекстом
 */
export function captureError(error, context = {}) {
    console.error("❌ Ошибка зафиксирована:", error.message);

    if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
            Object.entries(context).forEach(([key, value]) => {
                scope.setExtra(key, value);
            });
            Sentry.captureException(error);
        });
    }
}

export { Sentry };
