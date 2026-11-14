import { db } from '../db/index.js';
import type { Announcement } from '../types/index.js';

class AnnouncementStore {
	items = $state<Announcement[]>([]);
	lastReadAt = $state<string | null>(null);

	constructor() {
		if (typeof window !== 'undefined') {
			this.lastReadAt = localStorage.getItem('kasir_ann_read_at');
		}
	}

	get unreadCount(): number {
		const lastRead = this.lastReadAt;
		if (!lastRead) return this.items.length;
		return this.items.filter(a => (a.created_at || '') > lastRead).length;
	}

	async load(userId?: string): Promise<void> {
		try {
			if (userId) {
				this.lastReadAt = localStorage.getItem('kasir_ann_read_' + userId);
			}
			const all = await db.announcements.toArray();
			this.items = all
				.filter(a => a.is_active)
				.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
		} catch {
			this.items = [];
		}
	}

	markAllRead(userId?: string): void {
		if (typeof window === 'undefined') return;
		this.lastReadAt = new Date().toISOString();
		if (userId) {
			localStorage.setItem('kasir_ann_read_' + userId, this.lastReadAt);
		}
	}
}

export const announcementStore = new AnnouncementStore();
