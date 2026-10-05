/**
 * CAST — Domain model (Phase 0)
 *
 * Единые нормализованные типы. Бизнес-логика оперирует ТОЛЬКО этими типами,
 * никогда — сырыми ответами внешних API (StonkFun, Jupiter, ...).
 * Адаптеры обязаны приводить данные к этой модели на границе системы.
 */

// ── Token ──────────────────────────────────────────────

/** Жизненный статус токена на его платформе запуска. */
export type TokenStatus =
  | 'ACTIVE'       // торгуется на bonding curve / пуле
  | 'GRADUATING'   // близок к graduation
  | 'GRADUATED'    // вышел на DEX (Raydium и т.п.)
  | 'DEAD';        // нет рынка / заброшен

/** Риск-тир — производная от riskScore, определяет пулы Discover и визуал. */
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

/** Источник данных (для аудита и дедупликации; НЕ для ветвления логики). */
export type TokenSource = 'stonkfun' | 'dexscreener' | 'birdeye' | 'jupiter' | 'manual';

/**
 * Нормализованный токен — единственная форма, в которой токен
 * существует внутри приложения.
 */
export interface Token {
  /** Solana mint address (base58, верифицирован). Первичный ключ. */
  readonly mint: string;
  readonly symbol: string;
  readonly name: string;
  /** Sanitized URL изображения; может отсутствовать. */
  readonly imageUrl: string | null;
  readonly decimals: number;

  /** Цена в SOL (основная для PnL) и USD (для фильтров). */
  readonly priceSol: number | null;
  readonly priceUsd: number | null;

  readonly marketCapUsd: number | null;
  readonly volume24hUsd: number | null;
  readonly liquidityUsd: number | null;

  /** Momentum: изменение цены в % за период. */
  readonly priceChange1hPct: number | null;
  readonly priceChange24hPct: number | null;

  /** Момент создания токена on-chain (для age-фильтров и FRESH WATER). */
  readonly createdChainAt: Date | null;

  /** Категория/сектор от источника (xStock и т.п.), null если нет. */
  readonly category: string | null;

  readonly status: TokenStatus;
  /** Прогресс graduation 0–100, если применимо. */
  readonly graduationProgress: number | null;

  readonly source: TokenSource;
  /** Когда адаптер последний раз обновил запись. */
  readonly updatedAt: Date;
}

/** Вердикт Filtering Engine. Хранится вместе с токеном в пуле. */
export interface EligibilityVerdict {
  readonly eligible: boolean;
  /** 0 (безопасно) — 100 (максимальный риск). */
  readonly riskScore: number;
  /** Человекочитаемые причины (и для отказа, и для предупреждений). */
  readonly reasons: readonly string[];
  readonly checkedAt: Date;
}

/** Токен, прошедший через eligibility engine — кандидат в Fishing Pool. */
export interface PoolToken {
  readonly token: Token;
  readonly verdict: EligibilityVerdict;
  readonly riskTier: RiskTier;
}

/**
 * Полный on-chain risk-отчёт (Phase 3): вердикт + детали проверок.
 * Приходит с backend'а в фиде; frontend не пересчитывает.
 */
export interface RiskReport extends EligibilityVerdict {
  readonly riskTier: RiskTier;
  /** Реальная ликвидность из DexScreener (null — не проверено). */
  readonly liquidityUsd: number | null;
  /** Доля топ-1 держателя в % от supply (null — не проверено). */
  readonly top1HolderPct: number | null;
  /** Доля топ-10 держателей в % от supply. */
  readonly top10HolderPct: number | null;
  /** null — on-chain данные недоступны (unverified). */
  readonly mintAuthorityRevoked: boolean | null;
  readonly freezeAuthorityRevoked: boolean | null;
  /** Token-2022 transfer fee в basis points (null — нет налога / не проверено). */
  readonly transferFeeBps: number | null;
  /** Token program: spl-token или token-2022. */
  readonly tokenProgram: 'spl-token' | 'token-2022' | 'unknown';
}

// ── Discover modes ─────────────────────────────────────

export type DiscoverMode =
  | 'SURFACE'
  | 'DEEP_SEA'
  | 'ABYSS'
  | 'FRESH_WATER'
  | 'GRADUATION_HUNT'
  | 'VOLUME_HUNT'
  | 'CHAOS';

// ── Catch ──────────────────────────────────────────────

export type CatchStatus =
  | 'ACTIVE'            // позиции открыты (или симуляция)
  | 'PARTIALLY_FILLED'  // часть позиций не удалось открыть
  | 'CLOSING'           // идёт PULL OUT
  | 'CLOSED'            // всё продано, historical PnL зафиксирован
  | 'FAILED';           // CAST провалился целиком

export type PositionStatus =
  | 'PENDING'   // создана, покупка не подтверждена
  | 'FILLED'    // куплена (или активна в симуляции)
  | 'FAILED'    // не удалось купить (нет route, tx fail, ...)
  | 'SELLING'   // идёт продажа
  | 'SOLD';     // продана, realized PnL зафиксирован

/** Одна позиция внутри Catch. Все суммы — SOL. */
export interface Position {
  readonly id: string;
  readonly catchId: string;

  readonly tokenMint: string;
  readonly symbol: string;

  /** Плановая аллокация (результат randomizer'а). */
  readonly allocationSol: number;
  /** Фактически купленное количество токена. */
  readonly tokenAmount: number | null;

  readonly entryPriceSol: number | null;
  readonly currentPriceSol: number | null;

  readonly entryValueSol: number | null;
  readonly currentValueSol: number | null;

  /** Пересчитываются ТОЛЬКО на backend (PnL engine). */
  readonly realizedPnlSol: number;
  readonly unrealizedPnlSol: number;

  readonly status: PositionStatus;
  /** Подписи транзакций (null в симуляции). */
  readonly buyTx: string | null;
  readonly sellTx: string | null;
}

/** Корзина позиций — результат одного CAST. */
export interface Catch {
  readonly id: string;
  /** Публичный порядковый номер для shareable URL (/catch/1842). */
  readonly publicId: number;
  /** Публичный ключ владельца. Non-custodial: ключей больше нигде нет. */
  readonly walletAddress: string;

  readonly createdAt: Date;
  readonly closedAt: Date | null;

  readonly initialValueSol: number;
  readonly currentValueSol: number;
  readonly realizedValueSol: number;

  readonly status: CatchStatus;

  /**
   * Seed randomizer'а. Обязателен: позволяет воспроизвести Catch
   * (provably fair / reproducible catches).
   */
  readonly randomSeed: string;
  readonly riskMode: DiscoverMode;

  readonly positions: readonly Position[];
}

// ── Derived views (считаются на backend, отдаются frontend'у) ──

/** Сводка Catch для списка Catches. */
export interface CatchSummary {
  readonly catchId: string;
  readonly publicId: number;
  readonly status: CatchStatus;
  readonly investedSol: number;
  readonly currentValueSol: number;
  readonly pnlPct: number;
  readonly tokenCount: number;
  readonly bestPositionPnlPct: number | null;
  readonly worstPositionPnlPct: number | null;
}

/** Агрегаты профиля пользователя. */
export interface ProfileStats {
  readonly walletAddress: string;
  readonly totalInvestedSol: number;
  readonly realizedPnlSol: number;
  readonly unrealizedPnlSol: number;
  readonly totalCatches: number;
  readonly tokensCaught: number;
  readonly bestCatchPnlPct: number | null;
  readonly worstCatchPnlPct: number | null;
  readonly biggestWinner: { readonly tokenMint: string; readonly symbol: string; readonly pnlPct: number } | null;
  readonly biggestLoser: { readonly tokenMint: string; readonly symbol: string; readonly pnlPct: number } | null;
}
