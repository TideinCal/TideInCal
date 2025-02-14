import json
import sys
from deepdiff import DeepDiff

#py script to check if filtering the all stations query gives a different result.

def load_json(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            return json.load(file)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        sys.exit(1)

def compare_json(file1, file2):
    json1 = load_json(file1)
    json2 = load_json(file2)
    
    diff = DeepDiff(json1, json2, ignore_order=True)
    if not diff:
        print("The JSON files are identical.")
    else:
        print("Differences found:")
        print(diff)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python compare_json.py <file1.json> <file2.json>")
        sys.exit(1)
    
    compare_json(sys.argv[1], sys.argv[2])
