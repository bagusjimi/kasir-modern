import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
	extractPaginationParams,
	validateSortColumn,
	validateSortOrder
} from '../src/lib/server/pagination.ts';
import { buildPaginationMeta } from '../src/lib/types/pagination.ts';

describe('Smart Pagination & Filter Helpers', () => {
	it('extracts pagination with defaults when no query params are present', () => {
		const url = new URL('https://example.com/api/products');
		const result = extractPaginationParams(url, 20, 100);

		assert.strictEqual(result.page, 1);
		assert.strictEqual(result.limit, 20);
		assert.strictEqual(result.offset, 0);
		assert.strictEqual(result.paginate, false);
	});

	it('extracts pagination with explicit page and limit', () => {
		const url = new URL('https://example.com/api/products?page=3&limit=15');
		const result = extractPaginationParams(url, 20, 100);

		assert.strictEqual(result.page, 3);
		assert.strictEqual(result.limit, 15);
		assert.strictEqual(result.offset, 30);
		assert.strictEqual(result.paginate, true);
	});

	it('activates paginate when paginate=true is provided', () => {
		const url = new URL('https://example.com/api/products?paginate=true');
		const result = extractPaginationParams(url, 20, 100);

		assert.strictEqual(result.page, 1);
		assert.strictEqual(result.limit, 20);
		assert.strictEqual(result.paginate, true);
	});

	it('caps limit at maxLimit', () => {
		const url = new URL('https://example.com/api/products?page=1&limit=500');
		const result = extractPaginationParams(url, 20, 100);

		assert.strictEqual(result.limit, 100);
		assert.strictEqual(result.paginate, true);
	});

	it('handles invalid page or limit gracefully by resetting to defaults', () => {
		const url = new URL('https://example.com/api/products?page=-5&limit=abc');
		const result = extractPaginationParams(url, 25, 100);

		assert.strictEqual(result.page, 1);
		assert.strictEqual(result.limit, 25);
		assert.strictEqual(result.offset, 0);
	});

	it('validates sort column against whitelist', () => {
		const allowed = ['name', 'price', 'created_at', 'stock'];

		assert.strictEqual(validateSortColumn('price', allowed, 'created_at'), 'price');
		assert.strictEqual(validateSortColumn('STOCK', allowed, 'created_at'), 'stock');
		assert.strictEqual(validateSortColumn('invalid_col', allowed, 'created_at'), 'created_at');
		assert.strictEqual(validateSortColumn(null, allowed, 'created_at'), 'created_at');
		assert.strictEqual(validateSortColumn('', allowed, 'created_at'), 'created_at');
	});

	it('validates sort order', () => {
		assert.strictEqual(validateSortOrder('asc'), 'ASC');
		assert.strictEqual(validateSortOrder('ASC'), 'ASC');
		assert.strictEqual(validateSortOrder('desc'), 'DESC');
		assert.strictEqual(validateSortOrder('DESC'), 'DESC');
		assert.strictEqual(validateSortOrder('invalid', 'ASC'), 'DESC');
		assert.strictEqual(validateSortOrder(null, 'ASC'), 'ASC');
	});

	it('builds pagination meta correctly with total pages and next/prev flags', () => {
		const meta1 = buildPaginationMeta(45, 1, 10);
		assert.strictEqual(meta1.total, 45);
		assert.strictEqual(meta1.page, 1);
		assert.strictEqual(meta1.limit, 10);
		assert.strictEqual(meta1.total_pages, 5);
		assert.strictEqual(meta1.has_next, true);
		assert.strictEqual(meta1.has_prev, false);

		const metaMiddle = buildPaginationMeta(45, 3, 10);
		assert.strictEqual(metaMiddle.has_next, true);
		assert.strictEqual(metaMiddle.has_prev, true);

		const metaLast = buildPaginationMeta(45, 5, 10);
		assert.strictEqual(metaLast.has_next, false);
		assert.strictEqual(metaLast.has_prev, true);

		const metaEmpty = buildPaginationMeta(0, 1, 10);
		assert.strictEqual(metaEmpty.total, 0);
		assert.strictEqual(metaEmpty.total_pages, 1);
		assert.strictEqual(metaEmpty.has_next, false);
		assert.strictEqual(metaEmpty.has_prev, false);
	});
});
