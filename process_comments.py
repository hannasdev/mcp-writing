import json

def process():
    with open('comments.json', 'r') as f:
        comments = json.load(f)
    
    # Filter comments that might be from Copilot or have code suggestions
    # GitHub Copilot reviews often come from the 'github-copilot[bot]' user.
    for comment in comments:
        user = comment.get('user', {}).get('login', '')
        # Checking for Copilot bot or general review comments
        path = comment.get('path')
        line = comment.get('line') or comment.get('original_line')
        body = comment.get('body')
        
        print(f"File: {path}")
        print(f"Line: {line}")
        print(f"User: {user}")
        print(f"Comment:\n{body}")
        print("-" * 40)

if __name__ == "__main__":
    process()
