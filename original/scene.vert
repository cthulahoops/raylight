#version 130

// Input vertex data, different for all executions of this shader.
in vec3 vertexPosition_modelspace;
in vec3 vertexNormal;

uniform vec2 cameraPosition;
uniform vec2 loc;

out vec2 UV;
out vec3 fragmentNormal;
out vec2 fragmentPosition;

const float zoom = 0.002;

void main(){
    gl_Position.xyz = (vec3(cameraPosition, 0) + vec3(loc, 0) + vertexPosition_modelspace) * zoom;
    gl_Position.w = 1.0;
    
    fragmentPosition = (loc + vertexPosition_modelspace.xy) * zoom;
    UV = (fragmentPosition * 0.0008 * 0.5 / zoom + 1) / 2;

    fragmentNormal = vertexNormal;
}
