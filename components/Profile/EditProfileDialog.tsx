"use client";

import { useState } from "react";

import Dialog from "@/components/Profile/Dialog";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { BIO_MAX, DISPLAY_NAME_MAX, profileEditProblem } from "@/lib/profileView";
import { updateMyProfile, type Profile } from "@/lib/profiles";

/** Edit your display name and bio (the profile columns members may change). */
export default function EditProfileDialog({ profile, onSaved, onClose }: { profile: Profile; onSaved: (profile: Profile) => void; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    const problem = profileEditProblem({ displayName, bio });
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updateMyProfile({ displayName, bio });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.profile);
  }

  return (
    <Dialog title="Edit profile" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#cfcfcf]">Display name</span>
          <input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setError(null);
            }}
            maxLength={DISPLAY_NAME_MAX}
            required
            autoComplete="name"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-[#cfcfcf]">
            Bio
            <span className={`text-xs tabular-nums ${BIO_MAX - bio.length < 20 ? "text-[#f59e0b]" : "text-[#666]"}`}>{BIO_MAX - bio.length}</span>
          </span>
          <textarea
            value={bio}
            onChange={(e) => {
              setBio(e.target.value.replace(/[\r\n]+/g, " "));
              setError(null);
            }}
            maxLength={BIO_MAX}
            rows={3}
            placeholder="What do you invest in, and how?"
            className={`${inputClass} resize-none`}
          />
        </label>

        <p className="text-xs text-[#666]">
          Your @{profile.username} handle and photo come from sign-up and stay the same.
        </p>

        {error && (
          <p role="alert" className="text-sm text-[#f87171]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={primaryButtonClass}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
