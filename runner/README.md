# Notochord çalıştırıcısı

Simülatörü kontratlara bağlar. Hangi adımın sırada olduğunu zincirden okur, bu yüzden durup yeniden başlayabilir; her `step` en çok bir işlem gönderir.

| Komut | Ne yapar | Ağ |
| --- | --- | --- |
| `npm run runner:replay` | Tam deneyi geçmiş veri ve sahte drand ile geçici yerel zincirde oynatır; sonuçları deney sonucu değildir | Yalnızca yerel (Foundry'nin `anvil` aracı gerekir) |
| `npm run runner:check` | RPC, drand ve Hyperliquid erişimini okur | Okuma |
| `npm run runner:deploy -- --name X` | 6 tekrarı dağıtır | Gerçek ağ, para harcar |
| `npm run runner:run -- --name X` | Canlı döngü | Gerçek ağ, para harcar |
| `npm run runner:status -- --name X` | Sonuçları zincirden okur | Okuma |

Gerçek ağa yazmak için iki ortam değişkeni birlikte gerekir: `RUNNER_PRIVATE_KEY` ve `NOTOCHORD_LIVE=99901`. Anahtarı dosyaya veya sohbete yazma. RPC adresleri `RPC_URLS` ile virgülle verilir; biri yanıt vermezse sıradakine geçilir.

`runner/state/` yeniden üretilemeyen genomları içerir. Canlı çalıştırmada silinmemeli ve yedeklenmelidir.

Kontratlar değişirse `runner/artifacts/` yeniden üretilmelidir.
