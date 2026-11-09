import type { PaginationMeta } from '../types/pagination.js';

export interface PaginationParams {
	page: number;
	limit: number;
	offset: number;
	paginate: boolean; // whether smart pagination is requested
}

/**
 * Extracts and validates pagination parameters from URL search params.
 * Default limit is 20 if paginate is requested, max limit is 100.
 * If neither 'page' nor 'limit' is provided, paginate defaults to false,
 * allowing unpaginated or default limit mode for backward compatibility.
 */
export function extractPaginationParams(
	url: URL,
	defaultLimit: number = 20,
	maxLimit: number = 100
): PaginationParams {
	const pageParam = url.searchParams.get('page');
	const limitParam = url.searchParams.get('limit');
	const paginateParam = url.searchParams.get('paginate');

	const hasExplicitPaging = pageParam !== null || limitParam !== null || paginateParam === 'true';

	const parsedPage = parseInt(pageParam || '1', 10);
	const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

	const parsedLimit = parseInt(limitParam || String(defaultLimit), 10);
	let limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;
	if (limit > maxLimit) {
		limit = maxLimit;
	}

	const offset = (page - 1) * limit;

	return {
		page,
		limit,
		offset,
		paginate: hasExplicitPaging
	};
}

/**
 * Safely sanitizes and validates sort column against allowed whitelist.
 */
export function validateSortColumn(
	requestedSort: string | null | undefined,
	allowedColumns: string[],
	defaultColumn: string
): string {
	if (!requestedSort) return defaultColumn;
	const clean = requestedSort.trim().toLowerCase();
	return allowedColumns.includes(clean) ? clean : defaultColumn;
}

/**
 * Validates sort order (ASC or DESC).
 */
export function validateSortOrder(
	requestedOrder: string | null | undefined,
	defaultOrder: 'ASC' | 'DESC' = 'DESC'
): 'ASC' | 'DESC' {
	if (!requestedOrder) return defaultOrder;
	const clean = requestedOrder.trim().toUpperCase();
	return clean === 'ASC' ? 'ASC' : 'DESC';
}
