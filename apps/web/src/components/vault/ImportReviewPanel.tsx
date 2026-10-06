"use client";
import { useState } from "react";
import type { ImportPolicy, RestoreBackupInput } from "@vaultmaster/shared";
import { resolveImport, type ImportReview } from "@/lib/import-conflicts";

export default function ImportReviewPanel({ review, busy, commit, cancel }: {
  review: ImportReview; busy: boolean; commit: (body: RestoreBackupInput) => Promise<void>; cancel: () => void;
}) {
  const [policies, setPolicies] = useState<Record<number, ImportPolicy>>({});
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const replacing = Object.values(policies).includes("replace");
  const labels = { new: "Yeni", exact: "Aynı kayıt — atlanacak", "same-login": "Aynı giriş — değişiklik", renamed: "Yeniden adlandırılmış / içerik çakışması" };
  return <div aria-label="İçe aktarma incelemesi" className="space-y-3 rounded-xl border border-border p-4">
    <p className="text-sm">{review.rows.length} kayıt incelendi. Aynı kayıtlar atlanır; çakışmalar için seçim yapın. Şifreler ve giriş bilgileri bu raporda gösterilmez.</p>
    <p className="text-xs">Klasörler tek bir eşleşmede yeniden kullanılır. Etiketler kayıtla birlikte korunur; birleştirilmez. Çöp kayıtlarının üzerine yazılmaz.</p>
    {review.rows.map(row => <div key={row.index} className="flex items-center gap-3 text-sm">
      <span>Kayıt {row.index + 1}: {labels[row.kind]}</span>
      {row.kind !== "new" && row.kind !== "exact" && <select aria-label={`Kayıt ${row.index + 1} kararı`} disabled={busy} value={policies[row.index] ?? "skip"} onChange={event => { setApproved(false); setPolicies({ ...policies, [row.index]: event.target.value as ImportPolicy }); }} className="bg-surface p-2 rounded">
        <option value="skip">Mevcut kaydı koru, geleni atla</option>
        <option value="keep-both">İkisini de ayrı kayıt olarak tut</option>
        {row.replaceAllowed && <option value="replace">Mevcut kaydı güncelle</option>}
      </select>}
    </div>)}
    {replacing && <label className="block text-sm"><input type="checkbox" checked={approved} disabled={busy} onChange={event => setApproved(event.target.checked)} /> Seçtiğim mevcut kayıtların üzerine yazılmasını onaylıyorum. Tüm içerik, etiket, klasör ve favori gelen kayıtla değiştirilir; önceki içerik geçmişte saklanır.</label>}
    <button disabled={busy || (replacing && !approved)} className="rounded bg-accent px-4 py-2 text-midnight" onClick={async () => {
      setError("");
      try { await commit(resolveImport(review, policies, approved)); }
      catch { setError("İçe aktarma tamamlanamadı. Kasa değiştiyse iptal edip dosyayı yeniden inceleyin. Aynı incelemeyi tekrar denemek kopya oluşturmaz."); }
    }}>İncelemeyi Onayla ve İçe Aktar</button>
    <button disabled={busy} onClick={cancel} className="ml-3 px-4 py-2">İptal</button>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
