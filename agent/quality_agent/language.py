"""Draft language for agent drafts: "en" (default) or "id" (Bahasa Indonesia).

Only the wording of drafts changes; ids, citations and every validator rule stay the same. The Indonesian wording
uses phrases the validators recognise ("Hipotesis", "belum divalidasi", "Bukti belum tersedia", "belum ada bukti").
Historical record text (root causes, actions, containment) is quoted as stored in the corpus.
"""

from __future__ import annotations

from typing import Any

LANGUAGES = ("en", "id")

TEXT = {
    "en": {
        "d4_hypothesis": "Hypothesis (historical, not validated): {cause}, as recorded in {ids}.",
        "d4_none": "Evidence missing: no similar historical NCR was retrieved.",
        "d4_no_evidence": "No current-lot evidence is registered for {ncr}.",
        "d4_confirm": "Current-lot confirmation (controlled trial or inspection) of the hypothesis before D4 approval.",
        "d4_unverified": "No current-lot evidence is registered for {ncr}; the hypothesis stays unverified until it is.",
        "model_language": "",
        "d5_reuse": "{action} (reuses the corrective action of {id}).",
        "d5_none": "Evidence missing: no similar historical NCR was retrieved, so no corrective action can be reused.",
        "d5_verify": "Verification of each action on the next lots before D6.",
        "d5_withheld_all": "Evidence missing: no proposed corrective action passed the action check.",
        "d2_header": "Agent draft (5W2H from the NCR fields, rule-based, no model, not validated):",
        "d2_keys": ["What", "Where", "When", "Who", "Why it is a problem", "How it was detected", "How many"],
        "d2_missing_value": "Evidence missing.",
        "d2_missing_line": "Missing data: {keys} not recorded in the NCR.",
        "d2_when": "NCR recorded {date}; time of occurrence not recorded",
        "d2_who": "Assigned engineer {owner}",
        "d2_lot": "lot {lot}",
        "d2_units": "{n} affected units",
        "d2_of": " of {total} (as stated in the description)",
        "d3_header": "Agent proposal (containment reused from retrieved cases, no model, not validated). Adapt lot numbers and quantities to {ncr} before approval:",
        "d3_reuse": "{containment} (reuses the containment of {id}).",
        "d3_none": "Evidence missing. No containment from a similar historical NCR applies; define containment for {ncr} from the current lot.",
        "d7_header": "Agent proposal (prevention from recurring historical failures, no model, not validated) for {ncr}:",
        "d7_systemic": "Make the corrective action systemic across every {area} cell and part number: {action}. The failure recurred in {ids}.",
        "d7_fmea": "Add the failure mode ({cause}) to the {area} PFMEA and control plan review, because it recurred in {ids}.",
        "d7_none": "Evidence missing. The failure did not recur among the historical NCRs, so no prevention is proposed from precedent. Define prevention for {ncr} from the D4 and D5 results.",
    },
    "id": {
        "d4_hypothesis": "Hipotesis (historis, belum divalidasi): {cause}, seperti tercatat di {ids}.",
        "d4_none": "Bukti belum tersedia: tidak ada NCR historis serupa yang ditemukan.",
        "d4_no_evidence": "Belum ada bukti current-lot yang terdaftar untuk {ncr}.",
        "d4_confirm": "Konfirmasi current-lot (uji terkendali atau inspeksi) atas hipotesis sebelum persetujuan D4.",
        "d4_unverified": "Belum ada bukti current-lot yang terdaftar untuk {ncr}; hipotesis tetap belum terverifikasi sampai bukti terdaftar.",
        "model_language": "\n- Write root_cause, missing_data and every action in Bahasa Indonesia. Keep NCR and evidence ids unchanged. Phrase a root cause as \"Hipotesis: ...\" and say \"Bukti belum tersedia\" when evidence is missing.",
        "d5_reuse": "{action} (memakai ulang tindakan korektif {id}).",
        "d5_none": "Bukti belum tersedia: tidak ada NCR historis serupa yang ditemukan, jadi tidak ada tindakan korektif yang bisa dipakai ulang.",
        "d5_verify": "Verifikasi tiap tindakan pada lot berikutnya sebelum D6.",
        "d5_withheld_all": "Bukti belum tersedia: tidak ada usulan tindakan korektif yang lolos pemeriksaan tindakan.",
        "d2_header": "Draf agen (5W2H dari field NCR, berbasis aturan, tanpa model, belum divalidasi):",
        "d2_keys": ["Apa", "Di mana", "Kapan", "Siapa", "Mengapa menjadi masalah", "Bagaimana terdeteksi", "Berapa banyak"],
        "d2_missing_value": "Bukti belum tersedia.",
        "d2_missing_line": "Data yang kurang: {keys} tidak tercatat di NCR.",
        "d2_when": "NCR dicatat {date}; waktu kejadian tidak tercatat",
        "d2_who": "Engineer penanggung jawab {owner}",
        "d2_lot": "lot {lot}",
        "d2_units": "{n} unit terdampak",
        "d2_of": " dari {total} (sesuai deskripsi)",
        "d3_header": "Usulan agen (containment dipakai ulang dari kasus serupa, tanpa model, belum divalidasi). Sesuaikan nomor lot dan jumlah untuk {ncr} sebelum persetujuan:",
        "d3_reuse": "{containment} (memakai ulang containment {id}).",
        "d3_none": "Bukti belum tersedia. Tidak ada containment dari NCR historis serupa yang berlaku; tetapkan containment untuk {ncr} dari lot saat ini.",
        "d7_header": "Usulan agen (pencegahan dari kegagalan historis yang berulang, tanpa model, belum divalidasi) untuk {ncr}:",
        "d7_systemic": "Jadikan tindakan korektif sistemik di setiap sel {area} dan nomor part: {action}. Kegagalan ini berulang di {ids}.",
        "d7_fmea": "Tambahkan mode kegagalan ({cause}) ke tinjauan PFMEA dan control plan {area}, karena berulang di {ids}.",
        "d7_none": "Bukti belum tersedia. Kegagalan ini tidak berulang di NCR historis, jadi tidak ada usulan pencegahan dari preseden. Tetapkan pencegahan untuk {ncr} dari hasil D4 dan D5.",
    },
}


class LanguageError(ValueError):
    pass


def parse_language(payload: Any) -> str:
    value = payload.get("language", "en") if isinstance(payload, dict) else "en"
    if value not in LANGUAGES:
        raise LanguageError('language must be "en" or "id".')
    return value


def t(language: str, key: str, **values: str) -> Any:
    text = TEXT[language][key]
    return text.format(**values) if isinstance(text, str) else text
