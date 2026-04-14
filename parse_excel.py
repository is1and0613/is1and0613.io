import pandas as pd
import json
import re

# 读取Excel文件
df = pd.read_excel('信息大队22-25级女生信息.xlsx', header=None)

print('数据形状:', df.shape)
print('\n原始数据:')

# 打印所有数据以便查看
for i, row in df.iterrows():
    row_data = []
    for x in row:
        if pd.isna(x):
            row_data.append(None)
        else:
            row_data.append(str(x).strip() if isinstance(x, str) else x)
    print(f"Row {i}: {row_data}")
