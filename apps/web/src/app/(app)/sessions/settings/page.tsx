'use client';

import { useAuth } from '@/features/providers/auth-provider';
import { useCurrentAccountStore } from '@/stores/current-account-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Settings, Key, User, Shield } from 'lucide-react';

export default function SessionSettingsPage() {
  const { user } = useAuth();
  const { selectedAccountId } = useCurrentAccountStore();

  // Navigate to the accounts page for full settings
  const goToAccountSettings = (tab?: string) => {
    if (!selectedAccountId) return;
    const params = tab ? `?tab=${tab}` : '';
    window.location.href = `/accounts/${selectedAccountId}${params}`;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-semibold">الإعدادات</h1>
        <p className="text-muted-foreground text-sm">
          إعدادات الحساب، المفاتيح، الأمان، والتفضيلات
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* Account info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                معلومات الحساب
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">البريد:</span>
                <span>{user?.email || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">معرف الحساب:</span>
                <span className="font-mono text-xs">{selectedAccountId || '—'}</span>
              </div>
            </CardContent>
          </Card>

          {/* Quick settings */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => goToAccountSettings('general')}
            >
              <Settings className="h-4 w-4" />
              الإعدادات العامة
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => goToAccountSettings('tokens')}
            >
              <Key className="h-4 w-4" />
              مفاتيح API
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => goToAccountSettings('general')}
            >
              <Shield className="h-4 w-4" />
              الأمان
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
