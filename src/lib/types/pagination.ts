import type { Role, PaymentMethod, ExpenseCategory } from './index.js';

/**
 * Standard Pagination Metadata
 */
export interface PaginationMeta {
	total: number;
	page: number;
	limit: number;
	total_pages: number;
	has_next: boolean;
	has_prev: boolean;
}

/**
 * Standard Paginated Response
 */
export interface PaginatedResponse<T> {
	success: boolean;
	data: T[];
	pagination: PaginationMeta;
	filters?: Record<string, any>;
	message?: string;
}

/**
 * Helper to build pagination meta
 */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
	const total_pages = Math.max(1, Math.ceil(total / limit));
	return {
		total,
		page,
		limit,
		total_pages,
		has_next: page < total_pages,
		has_prev: page > 1
	};
}
