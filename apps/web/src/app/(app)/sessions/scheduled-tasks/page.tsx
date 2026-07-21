'use client';

import { ScheduledTasksPage } from '@/components/scheduled-tasks/scheduled-tasks-page';

export default function ScheduledTasksRoute() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-semibold">المهام المجدولة</h1>
        <p className="text-muted-foreground text-sm">
          جدولة مهام تلقائية تنطلق في أوقات محددة
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <ScheduledTasksPage />
      </div>
    </div>
  );
}
