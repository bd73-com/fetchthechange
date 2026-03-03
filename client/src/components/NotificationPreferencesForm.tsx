import { useState, useMemo } from "react";
import { useNotificationPreferences, useUpdateNotificationPreferences, useDeleteNotificationPreferences } from "@/hooks/use-notification-preferences";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, RotateCcw } from "lucide-react";

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

function getAllTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return COMMON_TIMEZONES;
  }
}

interface NotificationPreferencesFormProps {
  monitorId: number;
  compact?: boolean;
}

export function NotificationPreferencesForm({ monitorId, compact = false }: NotificationPreferencesFormProps) {
  const { data: prefs, isLoading } = useNotificationPreferences(monitorId);
  const { mutate: updatePrefs, isPending: isSaving } = useUpdateNotificationPreferences();
  const { mutate: deletePrefs, isPending: isDeleting } = useDeleteNotificationPreferences();

  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("08:00");
  const [timezone, setTimezone] = useState("");
  const [digestMode, setDigestMode] = useState(false);
  const [sensitivityThreshold, setSensitivityThreshold] = useState(0);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [initialized, setInitialized] = useState(false);

  const allTimezones = useMemo(() => getAllTimezones(), []);

  if (prefs && !initialized) {
    setQuietHoursEnabled(!!prefs.quietHoursStart && !!prefs.quietHoursEnd);
    setQuietHoursStart(prefs.quietHoursStart || "22:00");
    setQuietHoursEnd(prefs.quietHoursEnd || "08:00");
    setTimezone(prefs.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
    setDigestMode(prefs.digestMode);
    setSensitivityThreshold(prefs.sensitivityThreshold);
    setNotificationEmail(prefs.notificationEmail || "");
    setInitialized(true);
  }

  const handleSave = () => {
    updatePrefs({
      monitorId,
      quietHoursStart: quietHoursEnabled ? quietHoursStart : null,
      quietHoursEnd: quietHoursEnabled ? quietHoursEnd : null,
      timezone: quietHoursEnabled || digestMode ? timezone : null,
      digestMode,
      sensitivityThreshold,
      notificationEmail: notificationEmail.trim() || null,
    });
  };

  const handleReset = () => {
    deletePrefs(monitorId, {
      onSuccess: () => {
        setQuietHoursEnabled(false);
        setQuietHoursStart("22:00");
        setQuietHoursEnd("08:00");
        setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
        setDigestMode(false);
        setSensitivityThreshold(0);
        setNotificationEmail("");
        setInitialized(false);
      }
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const content = (
    <div className="space-y-5">
      {/* Quiet Hours */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="quiet-hours-toggle" className="font-medium">Quiet Hours</Label>
          <Switch
            id="quiet-hours-toggle"
            checked={quietHoursEnabled}
            onCheckedChange={setQuietHoursEnabled}
            data-testid="switch-quiet-hours"
          />
        </div>
        {quietHoursEnabled && (
          <div className="pl-1 space-y-3 border-l-2 border-border ml-2 pl-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="quiet-start" className="text-sm text-muted-foreground">Start</Label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={quietHoursStart}
                  onChange={(e) => setQuietHoursStart(e.target.value)}
                  data-testid="input-quiet-start"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="quiet-end" className="text-sm text-muted-foreground">End</Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={quietHoursEnd}
                  onChange={(e) => setQuietHoursEnd(e.target.value)}
                  data-testid="input-quiet-end"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="timezone" className="text-sm text-muted-foreground">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone" data-testid="select-timezone">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {allTimezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Digest Mode */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="digest-toggle" className="font-medium">Daily Digest</Label>
          <p className="text-xs text-muted-foreground">
            Batch changes into a single daily email at 9 AM
          </p>
        </div>
        <Switch
          id="digest-toggle"
          checked={digestMode}
          onCheckedChange={(val) => {
            setDigestMode(val);
            if (val && !timezone) {
              setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
            }
          }}
          data-testid="switch-digest"
        />
      </div>

      {digestMode && !quietHoursEnabled && (
        <div className="pl-1 border-l-2 border-border ml-2 pl-4">
          <div className="space-y-1">
            <Label htmlFor="digest-timezone" className="text-sm text-muted-foreground">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="digest-timezone" data-testid="select-digest-timezone">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {allTimezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Sensitivity Threshold */}
      <div className="space-y-1">
        <Label htmlFor="sensitivity" className="font-medium">Sensitivity Threshold</Label>
        <p className="text-xs text-muted-foreground">
          Minimum character difference to trigger notification (0 = any change)
        </p>
        <Input
          id="sensitivity"
          type="number"
          min={0}
          max={10000}
          value={sensitivityThreshold}
          onChange={(e) => setSensitivityThreshold(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-32"
          data-testid="input-sensitivity"
        />
      </div>

      {/* Notification Email Override */}
      <div className="space-y-1">
        <Label htmlFor="notification-email" className="font-medium">Notification Email</Label>
        <p className="text-xs text-muted-foreground">
          Override the default email for this monitor (leave blank for default)
        </p>
        <Input
          id="notification-email"
          type="email"
          placeholder="custom@example.com"
          value={notificationEmail}
          onChange={(e) => setNotificationEmail(e.target.value)}
          data-testid="input-notification-email"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={isSaving} size="sm" data-testid="button-save-prefs">
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Save Preferences
        </Button>
        <Button onClick={handleReset} disabled={isDeleting} variant="outline" size="sm" data-testid="button-reset-prefs">
          {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
          Reset
        </Button>
      </div>
    </div>
  );

  if (compact) {
    return content;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
        <CardDescription>
          Configure how and when you receive notifications for this monitor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
}
