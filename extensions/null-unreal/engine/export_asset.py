# Runs inside UnrealEditor-Cmd (-run=PythonScript). One engine boot exports a batch of assets.
#
# In:  the request file named by NULL_UNREAL_REQUEST (see src/exportFormat.ts).
# Out: one JSON per asset (plus PNG/GLB sidecars) under request.outputDir, and the manifest, rewritten
#      after every asset so a crash leaves a record of what finished. Data travels in files, never stdout.
#
# What the engine's Python API can reach was captured against UE 5.8 (see docs/specs/null-unreal-asset-core-design.md).
# A property that cannot be read is recorded as {"unreadable": "<reason>"}, never left out.
import json
import os
import re
import traceback

import unreal

SCHEMA = 1


def unreadable(reason):
    return {'unreadable': reason}


def jv(v, depth=0):
    """Any Unreal value as JSON-safe data."""
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if v == v and abs(v) != float('inf') else str(v)
    if isinstance(v, unreal.EnumBase):
        return v.name
    if isinstance(v, unreal.Object):
        return v.get_path_name()
    if isinstance(v, unreal.Name):
        return None if str(v) == 'None' else str(v)
    if isinstance(v, unreal.Text):
        return str(v)
    if isinstance(v, (list, tuple, set, unreal.Array, unreal.Set)):
        return [jv(x, depth + 1) for x in v]
    if isinstance(v, (dict, unreal.Map)):
        return {str(k): jv(x, depth + 1) for k, x in v.items()}
    if depth >= 4:
        return str(v)
    # A struct: its exposed fields.
    out = {}
    for n in field_names(v):
        try:
            out[n] = jv(getattr(v, n), depth + 1)
        except Exception:
            pass
    return out if out else str(v)


def field_names(obj):
    """Property names of obj's class. Class constants (LinearColor.BLACK, ...) and methods are not fields."""
    out = []
    for n in dir(type(obj)):
        a = getattr(type(obj), n, None)
        if not n.startswith('_') and hasattr(a, '__get__') and not callable(a):
            out.append(n)
    return out


# dir() shows only the editor-exposed properties of an expression; these are read by name on top of that.
EXTRA_PROPS = (
    'parameter_name', 'group', 'sort_priority', 'default_value', 'slider_min', 'slider_max', 'desc',
    'constant', 'r', 'g', 'b', 'a', 'const_a', 'const_b', 'material_function', 'text', 'size_x', 'size_y',
    'output_type', 'function_name', 'description', 'code', 'coordinate_index', 'u_tiling', 'v_tiling',
)


def prop(obj, name, default=None):
    try:
        return jv(obj.get_editor_property(name))
    except Exception:
        return default


def own_props(obj, skip=()):
    """Every readable property of obj's class as a dict (the editor-exposed ones, plus EXTRA_PROPS by name)."""
    out = {}
    for n in dict.fromkeys(field_names(obj) + list(EXTRA_PROPS)):
        if n in skip:
            continue
        try:
            out[n] = jv(obj.get_editor_property(n))
        except Exception:
            pass
    return out


def path_of(obj):
    return obj.get_path_name().split('.')[0] if obj is not None else None


# ---------------------------------------------------------------- material

MEL = unreal.MaterialEditingLibrary

# MP_MAX is not a real property and crashes the engine when asked; keep to this list.
OUTPUT_PROPERTIES = [
    ('BaseColor', 'MP_BASE_COLOR'), ('Metallic', 'MP_METALLIC'), ('Specular', 'MP_SPECULAR'),
    ('Roughness', 'MP_ROUGHNESS'), ('Anisotropy', 'MP_ANISOTROPY'), ('EmissiveColor', 'MP_EMISSIVE_COLOR'),
    ('Opacity', 'MP_OPACITY'), ('OpacityMask', 'MP_OPACITY_MASK'), ('Normal', 'MP_NORMAL'),
    ('Tangent', 'MP_TANGENT'), ('WorldPositionOffset', 'MP_WORLD_POSITION_OFFSET'),
    ('SubsurfaceColor', 'MP_SUBSURFACE_COLOR'), ('AmbientOcclusion', 'MP_AMBIENT_OCCLUSION'),
    ('Refraction', 'MP_REFRACTION'), ('FrontMaterial', 'MP_FRONT_MATERIAL'),
    ('MaterialAttributes', 'MP_MATERIAL_ATTRIBUTES'),
]
POSITION_PROPS = ('material_expression_editor_x', 'material_expression_editor_y')
PARAMETER_TYPES = {'TextureSample': 'Texture', 'TextureObject': 'Texture'}
PARAMETER_CLASS = re.compile(r'^MaterialExpression(\w*?)Parameter')


def material_data(mat):
    exprs = list(MEL.get_material_expressions(mat))
    index = {e.get_path_name(): i for i, e in enumerate(exprs)}

    def link(node, consumer):
        if node is None:
            return None
        i = index.get(node.get_path_name())
        if i is None:
            return {'from': unreadable('expression is not in the material graph'), 'output': None}
        return {'from': i, 'output': MEL.get_input_node_output_name_for_material_expression(consumer, node)}

    nodes = []
    parameters = []
    textures = set()
    for i, e in enumerate(exprs):
        cls = e.get_class().get_name()
        names = list(MEL.get_material_expression_input_names(e))
        types = list(MEL.get_material_expression_input_types(e))
        srcs = list(MEL.get_inputs_for_material_expression(mat, e))
        inputs = []
        for n, name in enumerate(names):
            src = link(srcs[n], e) if n < len(srcs) else None
            inputs.append({'name': str(name), 'type': int(types[n]) if n < len(types) else None, 'link': src})
        x, y = MEL.get_material_expression_node_position(e)
        props = own_props(e, skip=POSITION_PROPS)
        nodes.append({
            'index': i, 'class': cls, 'x': x, 'y': y, 'name': e.get_name(), 'properties': props,
            'inputs': inputs, 'outputs': [str(n) for n in MEL.get_material_expression_output_names(e)],
        })
        tex = props.get('texture')
        if isinstance(tex, str):
            textures.add(tex.split('.')[0])
        m = PARAMETER_CLASS.match(cls)
        if m and 'parameter_name' in props:
            default = props['texture'] if 'texture' in props else props.get('default_value')
            parameters.append({
                'name': props['parameter_name'], 'type': PARAMETER_TYPES.get(m.group(1), m.group(1)), 'class': cls,
                'group': props.get('group'), 'default': default,
            })

    outputs = {}
    for label, mp in OUTPUT_PROPERTIES:
        node = MEL.get_material_property_input_node(mat, getattr(unreal.MaterialProperty, mp))
        outputs[label] = None if node is None else {
            'from': index.get(node.get_path_name()),
            'output': MEL.get_material_property_input_node_output_name(mat, getattr(unreal.MaterialProperty, mp)),
        }

    return {
        'domain': prop(mat, 'material_domain'),
        'blendMode': prop(mat, 'blend_mode'),
        'shadingModel': prop(mat, 'shading_model'),
        'twoSided': prop(mat, 'two_sided'),
        'expressions': nodes,
        'outputs': outputs,
        'parameters': parameters,
        'usedTextures': sorted(textures),
        'nodeSize': unreadable('the editor does not expose node sizes to Python; derive one from the pin counts'),
        'commentBoxes': unreadable('comment boxes are not exposed to Python'),
    }


def material_instance_data(mi):
    def named(arr, field='parameter_value'):
        out = []
        for p in arr:
            out.append({'name': str(p.parameter_info.name), 'value': jv(getattr(p, field))})
        return out

    switches = []
    for name in MEL.get_static_switch_parameter_names(mi):
        if MEL.is_material_instance_parameter_overridden(mi, name):
            switches.append({'name': str(name), 'value': MEL.get_material_instance_static_switch_parameter_value(mi, name)})
    return {
        'parent': path_of(mi.get_editor_property('parent')),
        'scalar': named(mi.get_editor_property('scalar_parameter_values')),
        'vector': named(mi.get_editor_property('vector_parameter_values')),
        'texture': named(mi.get_editor_property('texture_parameter_values')),
        'staticSwitches': switches,
    }


# ---------------------------------------------------------------- texture

def texture_data(tex, png_path):
    built = tex.blueprint_get_built_texture_size()
    out = {
        'width': tex.blueprint_get_size_x(),
        'height': tex.blueprint_get_size_y(),
        'builtWidth': int(built.x),
        'builtHeight': int(built.y),
        'format': unreadable('the built pixel format is not exposed to Python'),
        'mipCount': unreadable('the built mip count is not exposed to Python'),
    }
    for key, name in [
        ('compression', 'compression_settings'), ('srgb', 'srgb'), ('lodGroup', 'lod_group'),
        ('mipGenSettings', 'mip_gen_settings'), ('filter', 'filter'), ('addressX', 'address_x'),
        ('addressY', 'address_y'), ('virtualTexture', 'virtual_texture_streaming'),
        ('neverStream', 'never_stream'), ('compressionNoAlpha', 'compression_no_alpha'),
        ('flipGreenChannel', 'flip_green_channel'), ('powerOfTwoMode', 'power_of_two_mode'),
    ]:
        out[key] = prop(tex, name, unreadable('property not found on this class'))
    return out


def export_file(obj, path):
    """AssetExportTask picks the exporter from the extension; returns True when a file was written."""
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = path
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    return bool(unreal.Exporter.run_asset_export_task(task)) and os.path.exists(path)


# ---------------------------------------------------------------- skeletal mesh

def bone_list(skeleton, mesh):
    names = [str(n) for n in unreal.AnimPoseExtensions.get_bone_names(skeleton.get_reference_pose())]
    if mesh is None:
        return [{'name': n, 'parent': unreadable('the skeleton has no preview mesh to read parents from')} for n in names]
    return [{'name': n, 'parent': None if str(mesh.get_bone_parent(n)) == 'None' else str(mesh.get_bone_parent(n))} for n in names]


def skeletal_mesh_data(sm):
    sub = unreal.get_editor_subsystem(unreal.SkeletalMeshEditorSubsystem)
    skeleton = sm.get_editor_property('skeleton')
    bounds = sm.get_bounds()
    return {
        'skeleton': path_of(skeleton),
        'bones': bone_list(skeleton, sm) if skeleton is not None else unreadable('the mesh has no skeleton'),
        'lods': [
            {'index': i, 'vertices': sub.get_num_verts(sm, i), 'sections': sub.get_num_sections(sm, i),
             'triangles': unreadable('triangle counts are not exposed to Python')}
            for i in range(sub.get_lod_count(sm))
        ],
        'materialSlots': [
            {'slot': str(m.material_slot_name), 'material': path_of(m.material_interface)}
            for m in sm.get_editor_property('materials')
        ],
        'morphTargets': [str(n) for n in sm.get_all_morph_target_names()],
        'bounds': jv(bounds),
    }


def skeleton_data(sk):
    return {'bones': bone_list(sk, sk.get_skeleton_preview_mesh()), 'previewMesh': path_of(sk.get_skeleton_preview_mesh())}


# ---------------------------------------------------------------- generic

def generic_data(obj, t3d_path):
    out = {'outer': path_of(obj.get_outer()) if obj.get_outer() is not None else None, 'properties': own_props(obj)}
    if export_file(obj, t3d_path):
        try:
            with open(t3d_path, encoding='utf-8', errors='replace') as f:
                out['textExport'] = f.read()
        finally:
            os.remove(t3d_path)
    else:
        out['textExport'] = unreadable('the engine has no text exporter for this class')
    return out


# ---------------------------------------------------------------- driver

def dependencies(pkg):
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    opts = unreal.AssetRegistryDependencyOptions()
    opts.include_hard_package_references = True
    opts.include_soft_package_references = True
    opts.include_searchable_names = False
    opts.include_soft_management_references = False
    opts.include_hard_management_references = False
    deps = {str(d) for d in ar.get_dependencies(pkg, opts)}
    return sorted(d for d in deps if d != pkg and not d.startswith('/Script/'))


def export_one(entry, req):
    pkg = entry['package']
    asset = unreal.load_asset(pkg)
    if asset is None:
        raise RuntimeError('the engine could not load ' + pkg)
    # /Game/A/B -> <outputDir>/Game/A/B.json, sidecars beside it.
    base = os.path.join(req['outputDir'], *pkg.strip('/').split('/'))
    os.makedirs(os.path.dirname(base), exist_ok=True)
    stem = os.path.basename(base)
    sidecars = {}

    if isinstance(asset, unreal.MaterialInstanceConstant):
        kind, data = 'material-instance', material_instance_data(asset)
    elif isinstance(asset, unreal.Material):
        kind, data = 'material', material_data(asset)
    elif isinstance(asset, unreal.Texture2D):
        kind, data = 'texture', texture_data(asset, base + '.png')
        sidecars['preview'] = stem + '.png' if export_file(asset, base + '.png') else unreadable('the PNG exporter failed')
    elif isinstance(asset, unreal.SkeletalMesh):
        kind, data = 'skeletal-mesh', skeletal_mesh_data(asset)
        sidecars['model'] = stem + '.glb' if export_file(asset, base + '.glb') else unreadable('the glTF exporter failed')
    elif isinstance(asset, unreal.Skeleton):
        kind, data = 'skeleton', skeleton_data(asset)
    else:
        kind, data = 'generic', generic_data(asset, base + '.t3d')

    doc = {
        'schema': SCHEMA,
        'engineVersion': req['engineVersion'],
        'sourceMtime': entry['sourceMtime'],
        'sourceSize': entry['sourceSize'],
        'package': pkg,
        'kind': kind,
        'class': asset.get_class().get_name(),
        'references': {'dependencies': dependencies(pkg)},
        'data': data,
        'sidecars': sidecars,
    }
    # Written last and atomically: a half-written entry is a cache miss, never wrong data.
    tmp = base + '.json.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, default=str)
    os.replace(tmp, base + '.json')


def write_manifest(req, status):
    tmp = req['manifest'] + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'schema': SCHEMA, 'assets': status}, f)
    os.replace(tmp, req['manifest'])


def main():
    with open(os.environ['NULL_UNREAL_REQUEST'], encoding='utf-8') as f:
        req = json.load(f)
    status = {}
    write_manifest(req, status)
    for entry in req['assets']:
        pkg = entry['package']
        try:
            export_one(entry, req)
            status[pkg] = {'status': 'exported'}
        except Exception as e:
            unreal.log_warning('null-unreal: %s failed: %s' % (pkg, traceback.format_exc()))
            status[pkg] = {'status': 'failed', 'error': '%s: %s' % (type(e).__name__, e)}
        write_manifest(req, status)


main()
