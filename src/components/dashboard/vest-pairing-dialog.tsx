'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { AlertCircle, CheckCircle2, Pencil } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface VestPairingDialogProps {
  activeVestId: string | null;
  onPair: (vestId: string) => Promise<void>;
  pairing: boolean;
  loading: boolean;
  triggerVariant?: ButtonProps['variant'];
  triggerSize?: ButtonProps['size'];
  triggerClassName?: string;
}

interface PairingState {
  validating: boolean;
  error: string | null;
  success: boolean;
}

export function VestPairingDialog({
  activeVestId,
  onPair,
  pairing,
  loading,
  triggerVariant = 'outline',
  triggerSize = 'sm',
  triggerClassName,
}: VestPairingDialogProps) {
  const [open, setOpen] = useState(false);
  const [newVestId, setNewVestId] = useState('');
  const [pairingState, setPairingState] = useState<PairingState>({
    validating: false,
    error: null,
    success: false,
  });
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setNewVestId('');
      setPairingState({ validating: false, error: null, success: false });
    }
  }, [open]);

  const handlePairing = async () => {
    const trimmedId = newVestId.trim();
    if (!trimmedId) return;

    setPairingState({ validating: true, error: null, success: false });

    try {
      await onPair(trimmedId);
      setPairingState({ validating: false, error: null, success: true });
      toast({
        title: 'Vest Paired Successfully',
        description: `Connected to vest ${trimmedId}.`,
      });
      setOpen(false);
    } catch (e: any) {
      const errorMessage = e.message || 'Could not pair with the vest.';
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          className={cn(triggerClassName)}
        >
          <Pencil />
          Change paired vest
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change paired vest</DialogTitle>
          <DialogDescription>
            Update which vest this guard session monitors.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">Currently paired</p>
            <p className="text-sm font-semibold">
              {loading ? 'Loading...' : activeVestId || 'None'}
            </p>
          </div>

          <div className="space-y-2">
            <Input
              value={newVestId}
              onChange={(e) => setNewVestId(e.target.value)}
              placeholder="Enter Vest ID (e.g., v001)"
              disabled={pairingState.validating || pairing}
              className="h-9"
            />
            <Button onClick={handlePairing} disabled={isDisabled} className="h-9 w-full">
              {pairingState.validating || pairing ? 'Validating...' : 'Pair vest'}
            </Button>
          </div>

          {pairingState.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{pairingState.error}</AlertDescription>
            </Alert>
          )}

          {pairingState.success && (
            <Alert className="border-emerald-600 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <AlertDescription className="text-emerald-600">
                Vest paired successfully!
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
