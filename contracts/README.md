# Notochord kontratları

Foundry projesi. Henüz hiçbir ağa dağıtılmadı.

| Kontrat | Görevi |
| --- | --- |
| `Generation` | Bir tekrarı kaydeder: adım sırası, drand taahhüdü, kararlar, uygunluk, seçilim ve yavrular |
| `Specimen` | Her örneğin kaydı (genom özeti, ebeveynler, doğum, eleme); `Generation` tarafından oluşturulur. Sahiplenme yoktur |
| `Fossil` | Her 10 nesilde ve son nesilde tam genomları hash kontrolüyle saklar |

## Kontrat neyi garanti eder?

Zincirde zorlanır: adım sırası, popülasyon boyutları, seçilimin en iyi yarıyı tutması, ebeveyn düzeni, drand turunun taahhüt anında gelecekte olması, fosil genomun kayıtlı SHA-256 ile eşleşmesi.

Henüz çalıştırıcıya güvenilir (zincir dışında herkes açık simülatörle kontrol edebilir): uygunluk değerleri, kararlar, genom özetleri, drand değerinin kendisi ve kontrolde elenenler. Bunları zincir üstünde denetleyecek Verifier 2. aşamadadır.

Her dağıtım bir tekrardır. Protokolün istatistiği için en az 6 tekrar, yani 6 ayrı `Generation` + `Fossil` dağıtımı gerekir.

## Çalıştırma

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # bir kez
cd contracts
forge test
```

`test/fixtures/r1-gen0-10.json`, simülatörün tekrar 1 çalıştırmasının ilk 10 neslidir. Yeniden üretmek için proje kökünde, fosiller varken: `npx tsx scripts/export-chain-fixture.ts`.

`lib/` içinde forge-std ve OpenZeppelin Contracts 5.6.1 kopyaları bulunur.
