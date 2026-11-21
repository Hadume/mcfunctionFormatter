# mcfunction Formatter

Minecraft Java Edition 1.21 以降のデータパック用 `.mcfunction` フォーマッター。

- コメントの `#` の数に応じたインデント（下の「インデント」を参照）
- `#> namespace:path` ヘッダーの挿入・上書き（`data/<ns>/function/<path>.mcfunction`）
- execute をサブコマンドごとに改行（入れ子の execute はさらに1段深く）
- セレクター・`scores` / `advancements`・NBT / JSON の展開、キーのクォート、`=` / `:` の空白
- 改行は行継続（行末 `\`）で表現する

## ゲームバージョンとコマンド構文

データパックの `pack.mcmeta` からゲームバージョンを判定し、そのバージョンのコマンド構文（Brigadier のコマンドツリー）を使います。

- `pack.mcmeta` は整形するファイルのフォルダから上にたどって探します。
- `pack_format`、または `min_format` / `max_format` の範囲に入るバージョンのうち、一番新しいリリース版を使います（リリース版がなければスナップショット）。
- コマンド構文は [misode/mcmeta](https://github.com/misode/mcmeta) から取得し、拡張機能の保存領域に保存して使い回します（バージョン一覧は1日ごとに更新）。
- 使い道：`execute` のサブコマンドの区切り（引数の数を数えるので、スコア名が `run` などでも誤らない）と、自由テキストを取る引数（`say` / `tell` / `kick` の理由など）の判定。

`pack.mcmeta` が見つからない・オフラインで取得できない場合は、`execute` をサブコマンドごとに分けず、普通のコマンドとして整形します（NBT・セレクターなどの整形はこれまでどおり）。

データの出典: [misode/mcmeta](https://github.com/misode/mcmeta)（Minecraft のデータ生成機能から作られた非公式データ）

## インデント

`##` 以上の見出しの `#` の数で段数が決まります（`##` の下は1段、`###` の下は2段）。`#` 1個は普通のコメントで、段数を変えません。`#>` で段数0に戻ります。

- 空行1行で、インデントが1段戻ります。
- 見出しは直前の行より1段深いところまでしか置けません。`#` が多すぎる見出し（`## A` の下の `#### B` など）は、`#` を減らして1段深い見出し（`### B`）に直します。
- 見出し（`#>` を含む）の前の空行は、直前の行の段数から見出し自身の高さまで下がるのに必要な数**ちょうど**にします（多ければ削り、少なければ足す）。
  - 子の見出し（1段深い）：0行。前にある空行はすべて消す
  - 同じ高さの見出し：1行
  - 1段上の見出し：2行（以降、段数が1つ減るごとに1行ずつ増える）
- 見出しの直前に（空行を挟まずに）書いた `#` 1個のコメントや `#expand` などの指定は、見出しとひとまとまりとして扱い、空行はその前に入れ、見出しと同じ高さに置きます。
- `#>` の直後の見出しの前には空行を1行入れます。`#>` の直後に続く `#` 1個のコメントは `#>` の説明として、そのまま `#>` にくっつけておきます。

```mcfunction
## A
    say a
    ### B
        say b
        # 普通のコメント
        say c

    say d           ← 空行で1段戻って A の中
    ### C
        say e
                    ← C を閉じる
                    ← A を閉じる（2段 → 見出しの高さ0段）
# D の説明          ← 見出しとひとまとまり
## D
    say f
                    ← 同じ高さの見出しなので1行
## E
```

## 開発

```bash
npm install
npm test        # ユニットテスト (vitest)
npm run compile # out/ にビルド
```

VSCode でこのフォルダを開いて F5 を押すと、拡張機能を読み込んだウィンドウが開きます。

```bash
npm run package # mcfunction-formatter-0.1.0.vsix を作る
```

できた `.vsix` は、拡張機能ビューの「…」→「VSIX からのインストール...」でインストールできます。

既定のフォーマッターが別の拡張機能（MC-Datapack-Utility など）になっている場合は、コマンドパレットの「ドキュメントのフォーマット方法...」→「既定のフォーマッタを構成...」で `mcfunction Formatter` を選んでください。

## 設定

| 設定 | 既定値 | 内容 |
|---|---|---|
| `mcfunctionFormatter.indent.enabled` / `.size` | `true` / `-1` | 見出しの `#` の数に応じたインデント。オフにすると元のインデントを保つ |
| `mcfunctionFormatter.header.enabled` | `true` | ヘッダーの挿入・上書き |
| `mcfunctionFormatter.command.keepLineBreaks` | `true` | 普通のコマンドで語と語の間に `\` で入れた改行を残す（続きの行は1段下げる）。オフで1行にまとめる |
| `mcfunctionFormatter.execute.mode` / `.indentSize` | `expand` / `-1` | execute |
| `mcfunctionFormatter.selector.mode` / `.indentSize` | `format` / `-1` | セレクターと、その中の `scores` / `advancements` |
| `mcfunctionFormatter.selector.equalsSpaces` | `0` | `=` の前後の空白の数（`-1` で書かれたまま） |
| `mcfunctionFormatter.selector.commaSpaces` | `0` | 同じ行に並べるときの `,` の後ろの空白の数（`-1` で書かれたまま） |
| `mcfunctionFormatter.nbt.mode` / `.indentSize` | `expand` / `-1` | NBT / JSON |
| `mcfunctionFormatter.nbt.quoteKeys` | `false` | キーを `"` でくくる |
| `mcfunctionFormatter.nbt.colonSpaces` | `1` | `:` の後ろの空白の数（`-1` で書かれたまま） |
| `mcfunctionFormatter.nbt.commaSpaces` | `1` | 同じ行に並べるときの `,` の後ろの空白の数（`-1` で書かれたまま） |
| `mcfunctionFormatter.attached.mode` | `format` | 語にくっついた `{...}` / `[...]`（ブロックステート、アイテムコンポーネント、ブロックエンティティの NBT、NBT パス） |

`indent.size` / `*.indentSize` を `-1` にすると、VSCode のインデント設定（タブ・空白の数）に従います。

モード:

- `expand`: 要素ごとに改行して展開する
- `format`: 1行のまま、キーのクォートと空白だけ整える（`\` の改行は1行に戻す）
- `none`: 書かれたまま残す（`\` の改行も含む）

## コメントによる指定

`#<key>[-<scope>][:<kinds>]` という形のコメント行で、設定を部分的に上書きできます（大文字・小文字は区別しない）。

| key | 動作 |
|---|---|
| `ignore` | 書かれたまま残す（`\` の改行やインデントも含む） |
| `expand` | 展開する |
| `flat` | 展開せず、1行のままキーのクォートと空白だけ整える |

| scope | 範囲 |
|---|---|
| なし | 次のコマンド1つ |
| `-section` | この行より下の、今いる `#` セクションの残り。子セクション（`##` など）には効かないが、子が閉じて戻ってきた後には再び効く。親には効かない |
| `-all` | `-section` の範囲と、その子セクション |

`:` の後に `execute` / `selector` / `nbt` / `attached` をカンマ区切りで書くと、その種類だけに効きます（省略するとすべて）。

```mcfunction
# 処理A
#expand-section
execute as @a run say 1       ← 展開する
## 子
    execute as @a run say 2   ← 効かない（-all なら効く）

execute as @a run say 3       ← 処理A に戻ったので再び効く

#ignore
execute as @a[tag=a,tag=b] at @s run say keep this

#flat: nbt, selector
data merge storage a:b {a:1}
```

- 複数の指定が重なったら、近いほうが勝つ（次のコマンドへの指定 → 今のセクションの `-section` → 近いセクションの `-all` の順）。
- 次のコマンドへの指定は、続けて書けば重ねられる。間に空行や普通のコメントがあると無効になる。
- `#ignore` / `#ignore-section` / `#ignore-all`（種類の指定なし）の範囲では、コメント行や空行も書かれたまま残す。
- 種類を指定した `#ignore:nbt` などは、その種類を `none`（書かれたまま）にするだけで、コマンドの他の部分は整形する。

## 仕様上の注意

- 構文チェックはしない。引用符と括弧の対応だけを見て整形する。
- 括弧の中で行末の `\` を書き忘れた行は、括弧が閉じるまで（空行・コメント・ファイル末尾より前に閉じる場合に限り）同じコマンドとしてつなぎ、`\` を補う。
- 括弧が閉じていない、`:` がないなど、解析できなかった括弧からコマンドの終わりまでは書かれたまま残し、それより前は整形する。
- 自由テキスト部分（`say` など）は整形しない。コマンド構文が取得できないときは `say` / `me` / `teammsg` / `tm` / `tell` / `msg` / `w` だけを自由テキストとして扱う。
- ブロックステート・アイテムコンポーネント（`stone[facing=north]` など）は、`=` / `~` の空白（`selector.equalsSpaces`）と中の NBT だけ整形する。
- `{` / `[` は直前の文字で扱いを決める。
  - 語の先頭（`tellraw @a {...}`、`set value [...]`）：独立した値として `nbt.mode` に従う
  - `@a` などの直後：セレクターとして `selector.mode` に従う。`expand` でなければ中の NBT（`nbt={...}`）も1行のまま
  - 語の途中（`A[{B:true}]`、`x{y:1}`、`stone[...]`、`chest{...}`）：語にくっついたものとして `attached.mode` に従う（既定は1行のまま）
  - 括弧の中の `=` `~` `:` `,` `[` の後：外側の括弧の扱いを引き継ぐ
  - そのため `setblock ~ ~ ~ chest{...}` のブロックエンティティの NBT も既定では1行のまま。逆に `data get entity @s {...}` のように語の先頭から始まる NBT パスは展開される。
- 選択範囲のフォーマットは、ファイル全体からインデントを計算し、選択範囲に重なるコマンドだけを置き換える。ヘッダーはファイル全体のフォーマットのときだけ扱う。
