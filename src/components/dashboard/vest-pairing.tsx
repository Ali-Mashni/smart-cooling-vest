'use client';

import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { useState } from 'react';
import { Loader } from '../layout/loader';
import { useToast } from '@/hooks/use-toast';

interface VestPairingProps {
  activeVestId: string | null;
  onPair: (vestId: string) => Promise<void>;
  pairing: boolean; // Is a pairing operation in progress
  loading: boolean; // Is the activeVestId being loaded
}

export function VestPairing({ activeVestId, onPair, pairing, loading }: VestPairingProps) {
  const [newVestId, setNewVestId] = useState('');
  const { toast } = useToast();

  const handlePairing = async () => {
    const trimmedId = newVestId.trim();
    if (!trimmedId) return;
    
    try {
      await onPair(trimmedId);
      toast({
        title: 'Pairing Request Sent',
        description: `Attempting to pair with vest ${trimmedId}.`,
      });
      setNewVestId('');
    } catch (e: any) {
      console.error('Pairing failed', e);
      toast({
        variant: 'destructive',
        title: 'Pairing Failed',
        description: e.message || 'Could not pair with the vest.',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vest Pairing</CardTitle>
        <CardDescription>
          Enter a Vest ID to pair with your device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader className="h-20" />
        ) : (
          <div>
            <p className="text-sm font-medium">Currently Paired Vest:</p>
            <p className="text-lg font-bold text-primary">
              {activeVestId || 'None'}
            </p>
          </div>
        )}
        <div className="flex w-full max-w-sm items-center space-x-2">
          <Input
            value={newVestId}
            onChange={(e) => setNewVestId(e.target.value)}
            placeholder="Enter Vest ID (e.g., v001)"
          />
          <Button onClick={handlePairing} disabled={pairing || !newVestId}>
            {pairing ? 'Pairing...' : 'Pair'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
