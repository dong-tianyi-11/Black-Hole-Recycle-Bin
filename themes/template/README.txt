自定义主题说明（参考 Clawd on Desk）
====================================

方式一：托盘 → 皮肤 →「从模板新建主题…」
方式二：托盘 → 皮肤 →「导入主题包（.zip）…」
方式三：托盘 → 皮肤 →「打开主题文件夹…」，手动拷贝本文件夹并改名

Zip 要求
--------
- 恰好一个 theme.json（在根目录或一层子文件夹内）
- 附带 assets/ 目录
- 必填状态 idle；建议 eatOpen / eatChew

编辑 theme.json
---------------
1. 删除 "_scaffoldOnly"（若仍存在）
2. 修改 name / eatLabel / toastOk
3. states 文件名对应 assets/ 下的图片

改完后：托盘 → 皮肤 →「刷新主题」
