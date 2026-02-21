import { cn } from '@/lib/utils';

export function Loader({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-screen w-full items-center justify-center',
        className
      )}
    >
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
