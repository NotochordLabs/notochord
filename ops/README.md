# Çalıştırma

**Sınanmadı:** Docker imajı ve systemd birimi henüz çalıştırılmadı.

Deney 100 gün boyunca saatte bir işlem gönderir. Çalıştırıcı durduğunda kaldığı yerden devam eder: sıradaki adımı zincirden okur. Tek sürekli veri `runner/state/` klasörüdür; kalıcı diskte tutulmalı ve yedeklenmelidir.

## Ortam değişkenleri

| Değişken | Anlamı |
| --- | --- |
| `RUNNER_PRIVATE_KEY` | Yalnız bu deney için ayrılmış cüzdan. Asla trade cüzdanı, asla depoya yazılmaz. |
| `NOTOCHORD_LIVE=99901` | Gerçek ağa yazma izni. |
| `RPC_URLS` | Virgülle ayrılmış RPC listesi; ilki düşerse sıradaki denenir. |
| `EXPERIMENT_NAME` | Docker için deney adı. |
| `ALERT_WEBHOOK_URL` | İsteğe bağlı. Sorun çıkınca `health` buraya mesaj gönderir. |
| `MIN_BALANCE_HYPE` | Bakiye uyarı sınırı; varsayılan 0,05. |

## Sıra

1. `npm run runner:check` tüm kaynakları denetler.
2. Küçük test dağıtımı: `npm run runner:deploy -- --name test-1 --replicates 1 --shuffled 0 --generations 2 --holdout 6`. Gerçek ücreti gösterir. Bu ad gerçek deneyle karışmamalı.
3. `npm run runner:run -- --name test-1` ve 2 nesil sonunda `npm run runner:verify -- --name test-1`.
4. Gerçek deney yalnız protokol kilitlendikten sonra dağıtılır.

## Kesinti sınırı

Düşünceler geriye dönük tamamlanır. Çalıştırıcı başlangıç saatinden önce çalışıyor olmalı; yoksa `commitGenesis` reddedilir ve dağıtım boşa gider. Eski kodda 24 saatten uzun bir boşluk tekrarı öldürebiliyordu; güncel kod planlanan drand turu geçtiyse daha geç bir tur seçer (test: 60 saat kesinti). Yine de kesintileri kısa tut.

## RPC

`RPC_URLS` zincire işlem iletmeli. `rpc.chainzy.io` okuma yapıyor, hash döndürüyor, ama işlem zincire ulaşmadı (3 Kasım 2026). Yeni bir adresi önce düşük ücretli bir işlemle dene. Tek RPC tek arıza noktasıdır; asıl deneyden önce ikinci bir adres eklenmeli.

## Sunucu

- **Docker:** `docker build -f ops/Dockerfile -t notochord-runner .`, sonra `runner/state` için kalıcı birim bağla. Birim `node` kullanıcısına yazılabilir olmalı.
- **systemd:** `ops/notochord-runner.service` dosyasını `notochord-runner@<ad>.service` olarak kur.

## İzleme

`npm run runner:health -- --name <ad>` zincirden okur: her tekrarın kaç saat geride olduğu, cüzdan bakiyesi, çalıştırıcının son sinyali. Sorun varsa çıkış kodu 1 olur. 15 dakikada bir çalıştır (`ops/notochord-health.timer`). Ürettiği `status.json`, siteye verilebilir.

## Herkes için doğrulama

`npm run runner:verify -- --manifest <yayımlanan manifest>`. Cüzdan gerekmez. Zincirdeki kararları, uygunlukları, fosilleri ve drand değerlerini açık girdilerden yeniden hesaplar; nesil başına bir düşünceyi ayrıca EVM üzerindeki ikinci beyin uygulamasına hesaplatır.

Sürüm uyarısı: genesis ve bağlantı ağırlıkları `Math.log` ve `Math.cos` kullanır; farklı JavaScript motorları son bitte ayrılabilir. Doğrulama, protokolde yazan Node sürümüyle yapılmalıdır.
