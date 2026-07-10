import * as React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Wallet } from 'lucide-react-native';

export default function BillingScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 items-center justify-center bg-background px-8"
      style={{ paddingBottom: insets.bottom }}
    >
      <Icon as={Wallet} size={32} className="text-muted-foreground/40" strokeWidth={1.5} />
      <Text className="mt-3 text-center font-roobert-medium text-[15px] text-foreground">
        Billing
      </Text>
      <Text className="mt-1 text-center font-roobert text-xs text-muted-foreground">
        Subscription and payment details will be available here soon.
      </Text>
    </View>
  );
}
