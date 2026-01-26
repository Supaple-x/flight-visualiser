"""
Blender script to convert FBX to GLB with embedded textures
Run with: blender --background --python convert_fbx_to_glb.py
"""
import bpy
import os
import sys

# Paths
script_dir = os.path.dirname(os.path.abspath(__file__))
fbx_path = os.path.join(script_dir, "public", "models", "drone.fbx")
glb_path = os.path.join(script_dir, "public", "models", "drone.glb")
textures_dir = os.path.join(script_dir, "public", "Textures")

print(f"Converting: {fbx_path}")
print(f"Output: {glb_path}")
print(f"Textures dir: {textures_dir}")

# Clear existing objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Import FBX
try:
    bpy.ops.import_scene.fbx(filepath=fbx_path)
    print("FBX imported successfully")
except Exception as e:
    print(f"Error importing FBX: {e}")
    sys.exit(1)

# Find and assign textures
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        print(f"Processing mesh: {obj.name}")

        # Check if object has materials
        for mat_slot in obj.material_slots:
            mat = mat_slot.material
            if mat is None:
                continue

            print(f"  Material: {mat.name}")

            # Enable nodes if not already
            if not mat.use_nodes:
                mat.use_nodes = True

            # Find Principled BSDF node
            principled = None
            for node in mat.node_tree.nodes:
                if node.type == 'BSDF_PRINCIPLED':
                    principled = node
                    break

            if principled is None:
                continue

            # Try to find and load textures
            # Check for textures in Textures folder
            for tex_folder in os.listdir(textures_dir):
                tex_folder_path = os.path.join(textures_dir, tex_folder)
                if not os.path.isdir(tex_folder_path):
                    continue

                for tex_file in os.listdir(tex_folder_path):
                    tex_path = os.path.join(tex_folder_path, tex_file)

                    # Check if this texture might belong to this material
                    if "_BC" in tex_file or "BaseColor" in tex_file or "Diffuse" in tex_file:
                        # Base Color texture
                        print(f"    Loading Base Color: {tex_file}")
                        tex_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
                        tex_node.image = bpy.data.images.load(tex_path)
                        mat.node_tree.links.new(tex_node.outputs['Color'], principled.inputs['Base Color'])

                    elif "_N" in tex_file and "ORM" not in tex_file:
                        # Normal map
                        print(f"    Loading Normal: {tex_file}")
                        tex_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
                        tex_node.image = bpy.data.images.load(tex_path)
                        tex_node.image.colorspace_settings.name = 'Non-Color'

                        normal_map = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                        mat.node_tree.links.new(tex_node.outputs['Color'], normal_map.inputs['Color'])
                        mat.node_tree.links.new(normal_map.outputs['Normal'], principled.inputs['Normal'])

                    elif "_ORM" in tex_file:
                        # ORM (Occlusion, Roughness, Metallic)
                        print(f"    Loading ORM: {tex_file}")
                        tex_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
                        tex_node.image = bpy.data.images.load(tex_path)
                        tex_node.image.colorspace_settings.name = 'Non-Color'

                        # Separate Color (Blender 5.0+ API)
                        separate = mat.node_tree.nodes.new('ShaderNodeSeparateColor')
                        separate.mode = 'RGB'
                        mat.node_tree.links.new(tex_node.outputs['Color'], separate.inputs['Color'])

                        # R = AO (not directly supported in simple setup)
                        # G = Roughness
                        mat.node_tree.links.new(separate.outputs['Green'], principled.inputs['Roughness'])
                        # B = Metallic
                        mat.node_tree.links.new(separate.outputs['Blue'], principled.inputs['Metallic'])

# Pack images - ignore errors for missing files
try:
    bpy.ops.file.pack_all()
except:
    print("Some files could not be packed, continuing anyway...")

# Export as GLB with embedded textures
try:
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_animations=True,
        export_image_format='AUTO'
    )
    print(f"GLB exported successfully: {glb_path}")
except Exception as e:
    print(f"Error exporting GLB: {e}")
    sys.exit(1)

print("Conversion complete!")
