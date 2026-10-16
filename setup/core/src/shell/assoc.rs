pub struct Assoc {
    pub key: &'static str,
    pub description: &'static str,
    pub extensions: &'static [&'static str],
    /// `resources\file-assoc-icons\<icon>.ico`; the key itself when `None`.
    pub icon: Option<&'static str>,
}

macro_rules! a {
    ($k:literal, $d:literal, [$($e:literal),+]) => { Assoc { key: $k, description: $d, extensions: &[$($e),+], icon: None } };
    ($k:literal, $d:literal, [$($e:literal),+], $i:literal) => { Assoc { key: $k, description: $d, extensions: &[$($e),+], icon: Some($i) } };
}

pub const TABLE: &[Assoc] = &[
    a!("js", "JavaScript File", [".js", ".jsx"]),
    a!("ts", "TypeScript File", [".ts", ".tsx"]),
    a!("python", "Python File", [".py"]),
    a!("json", "JSON File", [".json"]),
    a!("markdown", "Markdown File", [".md"]),
    a!("html", "HTML File", [".html", ".htm"]),
    a!("css", "CSS File", [".css"]),
    a!("yaml", "YAML File", [".yml", ".yaml"]),
    a!("text", "Text File", [".txt"]),
    a!("xml", "XML File", [".xml"]),
    a!("c", "C Source File", [".c"]),
    a!("h", "C/C++ Header File", [".h", ".hpp", ".inl"]),
    a!("cplus", "C++ Source File", [".cpp", ".cc", ".cxx", ".c++"]),
    a!("csharp", "C# Source File", [".cs"]),
    a!("go", "Go Source File", [".go"]),
    a!("rust", "Rust Source File", [".rs"]),
    a!("php", "PHP File", [".php"]),
    a!("ruby", "Ruby File", [".rb"]),
    a!("shell", "Shell Script", [".sh", ".bash", ".ps1"]),
    a!("database", "SQL File", [".sql"]),
    a!("git", "Git File", [".gitignore", ".gitattributes", ".gitconfig", ".gitmodules"]),
    a!("patch", "Patch File", [".patch"]),
    a!("cmake", "CMake File", [".cmake"]),
    a!("dart", "Dart File", [".dart"]),
    a!("docker", "Dockerfile", [".dockerfile"]),
    a!("notebook", "Jupyter Notebook", [".ipynb"]),
    a!("csproj", "C# Project File", [".csproj"]),
    a!("hplus", "C/C++ Header File", [".h++"]),
    a!("java", "Java File", [".java", ".jar"]),
    a!("lua", "Lua File", [".lua"]),
    a!("tex", "LaTeX File", [".latex"]),
    a!("config", "Configuration File", [".cfg", ".ini", ".config"], "document"),
    a!("workspace", "VS Code Workspace", [".code-workspace"], "document"),
    a!("iss", "Inno Setup Script", [".iss"], "document"),
    a!("log", "Log File", [".log"], "document"),
];

pub fn all_extensions() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for a in TABLE {
        for e in a.extensions {
            if !out.contains(e) {
                out.push(e);
            }
        }
    }
    out
}

pub fn prog_id(a: &Assoc) -> String { format!("NullIDE.AssocFile.{}", a.key) }
