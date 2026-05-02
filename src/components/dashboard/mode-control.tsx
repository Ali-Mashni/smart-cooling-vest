'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import type { VestMode } from '@/lib/types';
import { getDatabase, ref, serverTimestamp, set, push, onValue, type Unsubscribe } from 'firebase/database';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '../ui/alert';

const MODES: VestMode[] = ['Off', 'Eco', 'Normal', 'Boost'];

interface ModeControlProps {
  vestId: string | null;
  currentMode?: VestMode;
  isOffline?: boolean;
}

export function ModeControl({ vestId, currentMode, isOffline }: ModeControlProps) {
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const { toast } = useToast();

  const handleModeChange = async (mode: VestMode) => {
    if (!vestId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No vest is selected.',
      });
      return;
    }

    // Prevent command if vest is offline
    if (isOffline) {
      toast({
        variant: 'destructive',
        title: 'Vest Offline',
        description: 'Cannot send commands. The vest is currently offline.',
      });
      return;
    }

    setPendingCommand(mode);
    const db = getDatabase();
    const commandsRef = ref(db, `/vests/${vestId}/commands`);
    const newCommandRef = push(commandsRef);
    const commandId = newCommandRef.key;

    if (!commandId) {
      toast({ variant: 'destructive', title: 'Could not generate command ID' });
      setPendingCommand(null);
      return;
    }
    
    const startTime = Date.now();
    const command = {
      cmd: 'set_mode',
      value: mode,
      ts: serverTimestamp(),
    };

    try {
      await set(newCommandRef, command);
      
      const ackRef = ref(db, `/vests/${vestId}/acks/${commandId}`);
      
      let unsubscribe: Unsubscribe;

      const timeout = setTimeout(() => {
        if (unsubscribe) {
          unsubscribe();
        }
        toast({
          title: 'Command Queued',
          description: 'No ACK received. The device may be offline.',
        });
        setPendingCommand(null);
      }, 12000); // 12 second timeout

      unsubscribe = onValue(ackRef, (snapshot) => {
        if (snapshot.exists()) {
          clearTimeout(timeout);
          if (unsubscribe) {
            unsubscribe();
          }
          const latency = Date.now() - startTime;
          const toastResult = toast({
            title: 'Mode Change Acknowledged',
            description: `Vest mode set to ${mode}. (Latency: ${latency}ms)`,
          });
          
          // Subtract time from popup display: 1.3s if latency > 5s, else 0.7s
          const subtractMs = latency > 5000 ? 1300 : 700;
          const defaultDuration = 4000; // Default toast display time
          const displayDuration = Math.max(1000, defaultDuration - subtractMs);
          
          setTimeout(() => {
            toastResult.dismiss();
          }, displayDuration);
          
          setPendingCommand(null);
        }
      });

    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Command Failed',
        description: error.message,
      });
      setPendingCommand(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mode Control</CardTitle>
        <CardDescription>Set the operational mode of the vest.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isOffline && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Vest is offline — controls disabled.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODES.map((mode) => (
            <Button
              key={mode}
              variant="outline"
              className={cn(
                'w-full',
                currentMode === mode && 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
                pendingCommand === mode && 'opacity-50'
              )}
              disabled={!vestId || !!pendingCommand || isOffline}
              onClick={() => handleModeChange(mode)}
            >
              {pendingCommand === mode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode}
            </Button>
          ))}
          <Button
            variant="outline"
            className="w-full col-span-2 sm:col-span-4 opacity-70"
            disabled
            title="AI mode coming soon"
          >
            Auto (Coming soon)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">AI mode coming soon.</p>
      </CardContent>
    </Card>
  );
}
