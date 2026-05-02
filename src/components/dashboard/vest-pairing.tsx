'use client';

import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { useState, useEffect } from 'react';
import { Loader } from '../layout/loader';
import { useToast } from '@/hooks/use-toast';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface VestPairingProps {
  activeVestId: string | null;
  onPair: (vestId: string) => Promise<void>;
  pairing: boolean;
  loading: boolean;
}

interface PairingState {
  validating: boolean;
  error: string | null;
  success: boolean;
}

export function VestPairing({ activeVestId, onPair, pairing, loading }: VestPairingProps) {
  const [newVestId, setNewVestId] = useState('');
  const [pairingState, setPairingState] = useState<PairingState>({
    validating: false,
    error: null,
    success: false,
  });
  const { toast } = useToast();

  // Clean up success message timeout on unmount to prevent memory leaks
  useEffect(() => {
    if (!pairingState.success) return;
    const timeoutId = setTimeout(() => {
      setPairingState({ validating: false, error: null, success: false });
    }, 3000);
    return () => clearTimeout(timeoutId);
  }, [pairingState.success]);

  const handlePairing = async () => {
    // Trim input (preserve casing — backend will handle casing convention)
    const trimmedId = newVestId.trim();
    
    if (!trimmedId) return;

    setPairingState({ validating: true, error: null, success: false });

    try {
      await onPair(trimmedId);
      
      // Success state
      setPairingState({ validating: false, error: null, success: true });
      toast({
        title: 'Vest Paired Successfully',
        description: `Connected to vest ${trimmedId}.`,
      });
      setNewVestId('');
      // Success state will auto-clear via useEffect after 3 seconds
    } catch (e: any) {
      const errorMessage = e.message || 'Could not pair with the vest.';
      
      // Only log unexpected errors, not validation errors
      if (!errorMessage.includes('Invalid vest ID') && !errorMessage.includes('cannot be empty')) {
        console.error('Pairing failed', e);
      }
      
      setPairingState({ validating: false, error: errorMessage, success: false });
      
      toast({
        variant: 'destructive',
        title: 'Pairing Failed',
        description: errorMessage,
      });
    }
  };

  const isDisabled = pairing || pairingState.validating || !newVestId.trim();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Vest Pairing</CardTitle>
        <CardDescription className="text-xs">
          Enter a Vest ID to pair with your device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Loader className="h-20" />
        ) : (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Currently Paired Vest</p>
            <p className="text-base font-semibold text-primary">
              {activeVestId || 'None'}
            </p>
          </div>
        )}

        <div className="flex w-full items-center gap-2">
          <Input
            value={newVestId}
            onChange={(e) => setNewVestId(e.target.value)}
            placeholder="Enter Vest ID (e.g., v001)"
            disabled={pairingState.validating || pairing}
            className="h-9"
          />
          <Button 
            onClick={handlePairing} 
            disabled={isDisabled}
            className="h-9"
          >
            {pairingState.validating || pairing ? 'Validating...' : 'Pair'}
          </Button>
        </div>

        {/* Error Alert */}
        {pairingState.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {pairingState.error}
            </AlertDescription>
          </Alert>
        )}

        {/* Success Alert */}
        {pairingState.success && (
          <Alert className="border-green-600 bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Vest paired successfully!
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
