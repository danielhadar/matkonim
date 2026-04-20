#!/usr/bin/env python3
"""
Extract recipe titles from Google Docs HTML export.
Usage: python3 extract_recipes.py <html_file_path> <output_file_path>
"""

import sys
import re
from bs4 import BeautifulSoup
from pathlib import Path

def extract_recipe_titles(html_path, output_path):
    """Extract recipe titles from HTML export."""

    print(f"Reading {html_path}...")
    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()

    soup = BeautifulSoup(html_content, 'html.parser')

    # Extract CSS styles to identify title classes
    print("Analyzing CSS styles...")
    style_block = soup.find('style')
    title_classes = {}

    if style_block and style_block.string:
        style_text = style_block.string
        # Find all class definitions with their properties
        for match in re.finditer(r'\.(\w+)\s*\{([^}]+)\}', style_text):
            class_name = match.group(1)
            css_rules = match.group(2)

            # Extract font-size
            font_size_match = re.search(r'font-size:(\d+(?:\.\d+)?)pt', css_rules)
            font_size = float(font_size_match.group(1)) if font_size_match else 0

            # Check for bold
            is_bold = 'font-weight:700' in css_rules or 'font-weight: 700' in css_rules

            # Classes with large font or bold are likely titles
            if font_size >= 14 or (is_bold and font_size >= 11):
                title_classes[class_name] = {
                    'font_size': font_size,
                    'is_bold': is_bold
                }

    print(f"Found {len(title_classes)} title-styled classes")

    # Extract paragraphs with title styling
    print("Extracting recipe titles...")
    seen_titles = set()
    titles_with_snippets = []

    for elem in soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        classes = elem.get('class', [])
        if isinstance(classes, str):
            classes = [classes]

        # Check if element uses a title class
        is_title = any(c in title_classes for c in classes)

        if is_title:
            title_text = elem.get_text(strip=True)

            # Filter: must be meaningful length and not seen before
            if 2 < len(title_text) < 200 and title_text not in seen_titles:
                seen_titles.add(title_text)

                # Get next non-empty paragraph for context
                snippet = ""
                next_elem = elem.find_next(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
                attempts = 0
                while next_elem and not snippet and attempts < 3:
                    next_text = next_elem.get_text(strip=True)
                    if next_text and len(next_text) > 3:
                        snippet = next_text[:70]
                        break
                    next_elem = next_elem.find_next(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
                    attempts += 1

                titles_with_snippets.append((title_text, snippet))

    # Write output
    print(f"Found {len(titles_with_snippets)} unique titles")
    print(f"Writing to {output_path}...")

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(f"# Recipe titles found ({len(titles_with_snippets)})\n\n")

        for i, (title, snippet) in enumerate(titles_with_snippets, 1):
            snippet_str = f" — {snippet}" if snippet else ""
            f.write(f"{i}. **{title}**{snippet_str}\n")

        f.write("\n## Notes / caveats\n")
        f.write("- Extraction based on CSS font-size >= 14pt or bold text\n")
        f.write("- Hebrew RTL text preserved\n")
        f.write("- Deduplication applied\n")
        f.write("- Snippet shows first text paragraph after title for sanity-check\n")
        f.write("- Some entries may be section headers rather than recipes\n")

    print(f"Done! Results written to {output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 extract_recipes.py <html_file_path> [output_file_path]")
        sys.exit(1)

    html_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else 'recipe_titles.md'

    if not Path(html_file).exists():
        print(f"Error: File not found: {html_file}")
        sys.exit(1)

    try:
        extract_recipe_titles(html_file, output_file)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
