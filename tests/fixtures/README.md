Os fixtures impact.mp3 e impact.ogg derivam exclusivamente da síntese original
public/sounds/impact.wav. Não são cópias de áudios da referência. Licença MIT do
projeto. Foram criados com FFmpeg para testar decodificação no Chromium:

```sh
ffmpeg -i public/sounds/impact.wav -codec:a libmp3lame -q:a 6 -map_metadata -1 tests/fixtures/impact.mp3
ffmpeg -i public/sounds/impact.wav -codec:a libvorbis -q:a 3 -map_metadata -1 tests/fixtures/impact.ogg
```

FFmpeg não é dependência de runtime nem necessário para rodar testes; os pequenos
fixtures já estão versionados. O aplicativo distribui apenas o WAV como padrão.
