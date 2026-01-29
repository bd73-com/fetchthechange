import { useState } from "react";
import { type Monitor } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Search, Check, Copy, AlertCircle, CheckCircle, XCircle, Wrench } from "lucide-react";
import { useSuggestSelectors, useUpdateMonitorSilent, useCheckMonitorSilent } from "@/hooks/use-monitors";
import { useToast } from "@/hooks/use-toast";

interface FixSelectorModalProps {
  monitor: Monitor;
}

type SelectorSuggestion = {
  selector: string;
  count: number;
  sampleText: string;
};

type CheckResult = {
  status: string;
  currentValue: string | null;
  error?: string | null;
};

export function FixSelectorModal({ monitor }: FixSelectorModalProps) {
  const [open, setOpen] = useState(false);
  const [expectedText, setExpectedText] = useState("");
  const [suggestions, setSuggestions] = useState<SelectorSuggestion[]>([]);
  const [currentSelectorInfo, setCurrentSelectorInfo] = useState<{ selector: string; count: number; valid: boolean } | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [applyingSelector, setApplyingSelector] = useState<string | null>(null);
  const [copiedSelector, setCopiedSelector] = useState<string | null>(null);

  const { mutate: suggestSelectors, isPending: isSuggesting, error: suggestError } = useSuggestSelectors();
  const { mutateAsync: updateMonitor } = useUpdateMonitorSilent();
  const { mutateAsync: checkMonitor } = useCheckMonitorSilent();
  const { toast } = useToast();

  const handleSuggest = () => {
    setSuggestions([]);
    setCurrentSelectorInfo(null);
    setCheckResult(null);

    suggestSelectors(
      { id: monitor.id, expectedText: expectedText.trim() || undefined },
      {
        onSuccess: (data) => {
          setSuggestions(data.suggestions);
          setCurrentSelectorInfo(data.currentSelector);
        },
      }
    );
  };

  const handleUseSelector = async (selector: string) => {
    setApplyingSelector(selector);
    setCheckResult(null);

    try {
      await updateMonitor({ id: monitor.id, selector });
      const result = await checkMonitor(monitor.id);
      setCheckResult({
        status: result.status || (result.currentValue ? "ok" : "error"),
        currentValue: result.currentValue,
        error: result.error,
      });
      
      if (result.status === "ok" || result.currentValue) {
        toast({ title: "Selector updated", description: "The new selector is working." });
      }
    } catch (err) {
      setCheckResult({
        status: "error",
        currentValue: null,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setApplyingSelector(null);
    }
  };

  const handleCopy = async (selector: string) => {
    await navigator.clipboard.writeText(selector);
    setCopiedSelector(selector);
    setTimeout(() => setCopiedSelector(null), 2000);
  };

  const resetState = () => {
    setExpectedText("");
    setSuggestions([]);
    setCurrentSelectorInfo(null);
    setCheckResult(null);
    setApplyingSelector(null);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) resetState();
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-fix-selector">
          <Wrench className="h-4 w-4 mr-2" />
          Fix selector
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fix Selector</DialogTitle>
          <DialogDescription>
            Find a working CSS selector for this monitor. Enter expected text to narrow down suggestions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="flex gap-2">
            <Input
              placeholder='Expected text (e.g., "$3,200.00", "In stock")'
              value={expectedText}
              onChange={(e) => setExpectedText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSuggest()}
              disabled={isSuggesting}
              data-testid="input-expected-text"
            />
            <Button onClick={handleSuggest} disabled={isSuggesting} data-testid="button-suggest-selectors">
              {isSuggesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Suggest</span>
            </Button>
          </div>

          {isSuggesting && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span>Scanning page for selectors... This may take up to 30 seconds.</span>
            </div>
          )}

          {suggestError && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">{suggestError.message}</span>
            </div>
          )}

          {currentSelectorInfo && currentSelectorInfo.valid && (
            <div className="flex items-center gap-2 p-3 bg-secondary border border-border rounded-md text-foreground">
              <CheckCircle className="h-4 w-4 flex-shrink-0 text-primary" />
              <span className="text-sm">
                Your current selector already matches {currentSelectorInfo.count} element{currentSelectorInfo.count !== 1 ? "s" : ""}.
              </span>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                Found {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}
              </h4>
              <div className="space-y-2">
                {suggestions.map((suggestion, index) => (
                  <Card key={index} className="overflow-hidden">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <code className="text-xs bg-secondary px-2 py-1 rounded font-mono break-all flex-1" data-testid={`text-selector-${index}`}>
                          {suggestion.selector}
                        </code>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Badge variant="secondary" className="text-xs">
                            {suggestion.count} match{suggestion.count !== 1 ? "es" : ""}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopy(suggestion.selector)}
                            title="Copy selector"
                            data-testid={`button-copy-selector-${index}`}
                          >
                            {copiedSelector === suggestion.selector ? (
                              <Check className="h-3 w-3 text-primary" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground break-words" data-testid={`text-sample-${index}`}>
                        {suggestion.sampleText.length > 120 
                          ? suggestion.sampleText.substring(0, 120) + "..." 
                          : suggestion.sampleText}
                      </p>
                      <Button
                        variant="default"
                        size="sm"
                        className="w-full"
                        onClick={() => handleUseSelector(suggestion.selector)}
                        disabled={applyingSelector !== null}
                        data-testid={`button-use-selector-${index}`}
                      >
                        {applyingSelector === suggestion.selector ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin mr-2" />
                            Applying & checking...
                          </>
                        ) : (
                          <>
                            <Check className="h-3 w-3 mr-2" />
                            Use this selector
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {suggestions.length === 0 && currentSelectorInfo && !currentSelectorInfo.valid && !isSuggesting && (
            <div className="text-center py-6 text-muted-foreground">
              <p>No matching selectors found.</p>
              <p className="text-sm mt-1">Try a different expected text, or leave it empty to scan all visible elements.</p>
            </div>
          )}

          {checkResult && (
            <div className="space-y-2 pt-2 border-t">
              <h4 className="text-sm font-medium">Check Result</h4>
              <div className={`p-3 rounded-md border ${
                checkResult.status === "ok" 
                  ? "bg-secondary border-border" 
                  : "bg-destructive/10 border-destructive/20"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {checkResult.status === "ok" ? (
                    <CheckCircle className="h-4 w-4 text-primary" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <Badge variant={checkResult.status === "ok" ? "default" : "destructive"} data-testid="badge-check-status">
                    {checkResult.status}
                  </Badge>
                </div>
                {checkResult.status === "ok" && checkResult.currentValue && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Extracted value:</span>
                    <p className="font-mono text-sm bg-secondary/50 p-2 rounded break-words" data-testid="text-extracted-value">
                      {checkResult.currentValue}
                    </p>
                  </div>
                )}
                {checkResult.status !== "ok" && checkResult.error && (
                  <p className="text-sm text-destructive" data-testid="text-check-error">
                    {checkResult.error}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
